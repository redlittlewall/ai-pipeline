import hashlib
import os
from pathlib import Path
import re
import subprocess
import time
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from pipeline.profiles.registry import registry
from pipeline.quality_score import (
    CoverageMetrics,
    NegativeBranchAnalysis,
    QualityConfidenceScore,
    _format_line_ranges,
    analyze_negative_branches,
    calculate_quality_confidence_score,
    parse_coverage_final_json,
)
from pipeline.queue_manager import QueueManager, Task


def get_file_hash(path: Path) -> str:
    if not path.exists():
        return ""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def check_anti_sut_mocking(spec_content: str) -> Optional[str]:
    """Detects if the test attempts to mock the SUT (System Under Test) instead of dependencies."""
    forbidden_patterns = [
        (r"spyOn\(\s*service\s*,", "jest.spyOn(service, ...)"),
        (r"spyOn\(\s*sut\s*,", "jest.spyOn(sut, ...)"),
        (r"service\.\w+\s*=\s*jest\.fn\(", "service.<method> = jest.fn(...)"),
        (r"sut\.\w+\s*=\s*jest\.fn\(", "sut.<method> = jest.fn(...)"),
    ]
    for pattern, name in forbidden_patterns:
        if re.search(pattern, spec_content, re.IGNORECASE):
            return (
                f"VIOLAÇÃO CRÍTICA (Khorikov SUT Anti-Pattern): Detectado `{name}`. "
                f"É estritamente proibido mockar a própria classe/método que está sendo testada. "
                f"O método sob teste DEVE executar sua lógica real. Mocke apenas as dependências injetadas."
            )
    return None


def parse_line_coverage(stdout: str, service_file_name: str) -> Optional[float]:
    """Extracts line coverage percentage from Jest coverage table output."""
    clean_name = Path(service_file_name).name
    stem = Path(service_file_name).stem

    for line in stdout.splitlines():
        if "|" in line:
            parts = [p.strip() for p in line.split("|")]
            # Table format: File | % Stmts | % Branch | % Funcs | % Lines | Uncovered
            if len(parts) >= 6:
                filename_col = parts[0]
                # Match full name, stem, or stripped ellipsis
                stripped_col = filename_col.lstrip(".").strip()
                if (
                    clean_name in filename_col
                    or stem in filename_col
                    or (stripped_col and stripped_col in clean_name)
                ):
                    try:
                        return float(parts[4])
                    except ValueError:
                        pass
    return None


def sanitize_mock_types(spec_text: str) -> str:
    """Normalizes import prefixes and ensures well-formed spec file structure (Zero-AI)."""
    # 1. Strip 'src/' prefix from module imports (NestJS baseUrl is already 'src')
    spec_text = re.sub(r"from\s+(['\"])src/([^'\"]+)\1", r"from \1\2\1", spec_text)

    # 2. Heal truncated spec files (when LLM output hits max_tokens mid-block)
    if not spec_text.rstrip().endswith("});"):
        last_describe_close = spec_text.rfind("\n  });")
        if last_describe_close != -1:
            spec_text = spec_text[: last_describe_close + 6] + "\n});\n"

    return spec_text



def prune_failing_tests(spec_text: str, jest_output: str) -> Optional[str]:
    """Removes specific failing it(...) blocks (scoped by describe block) while keeping passing tests."""
    clean_out = re.sub(r'\x1b\[[0-9;]*m', '', jest_output)
    failing_pairs = []
    for line in clean_out.splitlines():
        m = re.match(r'^\s*●\s+(.+)$', line)
        if m:
            full_title = m.group(1).strip()
            if "Test suite failed to run" in full_title:
                continue
            parts = [p.strip() for p in full_title.split("›")]
            if len(parts) >= 3:
                failing_pairs.append((parts[-2], parts[-1]))
            elif len(parts) == 2:
                failing_pairs.append((None, parts[-1]))

    if not failing_pairs:
        return None

    modified = spec_text
    removed_count = 0
    for desc_name, title in failing_pairs:
        search_offset = 0
        if desc_name:
            desc_esc = re.escape(desc_name)
            desc_match = re.search(rf'\bdescribe\s*\(\s*[\'"`]{desc_esc}[\'"`]\s*,', modified)
            if desc_match:
                search_offset = desc_match.start()

        escaped = re.escape(title)
        pattern = re.compile(rf'^[ \t]*(?:it|test)\s*\(\s*[\'"`]{escaped}[\'"`]\s*,', re.MULTILINE)
        match = pattern.search(modified, pos=search_offset)
        if not match and search_offset > 0:
            match = pattern.search(modified)
        if not match:
            continue
        start_idx = match.start()
        paren_depth = 0
        in_str = None
        escape_next = False
        end_idx = None
        for i in range(start_idx, len(modified)):
            ch = modified[i]
            if escape_next:
                escape_next = False
                continue
            if ch == '\\':
                escape_next = True
                continue
            if in_str:
                if ch == in_str:
                    in_str = None
                continue
            if ch in ('"', "'", '`'):
                in_str = ch
                continue
            if ch == '(':
                paren_depth += 1
            elif ch == ')':
                paren_depth -= 1
                if paren_depth == 0:
                    j = i + 1
                    while j < len(modified) and modified[j] in (' ', '\t', ';'):
                        j += 1
                    if j < len(modified) and modified[j] == '\n':
                        j += 1
                    end_idx = j
                    break
        if end_idx:
            modified = modified[:start_idx] + modified[end_idx:]
            removed_count += 1

    remaining_it_count = len(re.findall(r'\b(?:it|test)\s*\(', modified))
    if removed_count > 0 and remaining_it_count >= 2:
        return modified
    return None


def format_refinement_prompt(
    base_prompt: str,
    attempt_history: List[str],
    current_instruction: str,
    type_context: str = "",
) -> str:
    """Enriches the base golden prompt with a cumulative memory of previous failures and surgical feedback for the current attempt."""
    history_block = ""
    if attempt_history:
        history_lines = "\n".join(f"• {h}" for h in attempt_history)
        history_block = (
            "\n================================================================================\n"
            "HISTÓRICO CUMULATIVO DE FALHAS NESTA TAREFA (NÃO REPITA ESTES ERROS!):\n"
            "================================================================================\n"
            f"{history_lines}\n"
        )

    surgical_block = (
        "\n================================================================================\n"
        "DIAGNÓSTICO CIRÚRGICO E INSTRUÇÃO PARA A TENTATIVA ATUAL:\n"
        "================================================================================\n"
        f"{current_instruction}\n"
    )

    return f"{base_prompt}\n{history_block}{surgical_block}{type_context if type_context else ''}"


def is_repository_or_type_error(error_text: str) -> bool:
    """Identifies if Jest/TypeScript failure is due to missing repository methods or incompatible types."""
    if not error_text:
        return False

    # TypeScript errors (TS2345, TS2339, TS2352, TS2322)
    if re.search(r"\b(TS2345|TS2339|TS2352|TS2322)\b", error_text):
        return True

    # Jest runtime TypeErrors
    if "TypeError" in error_text:
        return True

    # Distinct TypeORM method/function names (never ambiguous with standard English)
    distinct_repo_methods = [
        "softDelete",
        "createQueryBuilder",
        "findAndCount",
        "findOne",
        "getOne",
        "getMany",
        "getRawOne",
        "getRawMany",
        "getRepositoryToken",
        "leftJoinAndSelect",
        "innerJoinAndSelect",
    ]
    if any(re.search(rf"\b{re.escape(m)}\b", error_text) for m in distinct_repo_methods):
        return True

    # Common CRUD methods must be preceded by a dot (e.g. .find(, .save(, .delete()
    common_crud_methods = [
        "find",
        "save",
        "delete",
        "count",
        "update",
        "insert",
        "restore",
        "preload",
        "merge",
    ]
    if any(re.search(rf"\.{re.escape(m)}\b", error_text) for m in common_crud_methods):
        return True

    # Generic repository keywords
    if "Repository" in error_text or "getRepositoryToken" in error_text:
        return True

    return False


def identify_failed_entities(error_text: str, service_code: str) -> List[str]:
    """Identifies which TypeORM entities are associated with the failure based on error and service dependencies."""
    if not service_code:
        return []

    # 1. Parse repository dependencies and injected entities in the constructor
    repo_param_to_entity: Dict[str, str] = {}
    service_repo_entities: List[str] = []

    ctor_match = re.search(r"constructor\s*\(([\s\S]*?)\)\s*\{", service_code)
    if ctor_match:
        params_block = ctor_match.group(1)
        param_pattern = re.compile(
            r"(?:@InjectRepository\((?P<entity>\w+)\)\s*)?"
            r"(?:private|protected|public)?\s*(?:readonly)?\s*"
            r"(?P<param_name>\w+)\s*:\s*"
            r"(?P<param_type>[A-Za-z0-9_<>]+)"
        )
        for match in param_pattern.finditer(params_block):
            entity = match.group("entity")
            p_name = match.group("param_name")
            p_type = match.group("param_type")
            is_repo = bool(entity) or "Repository<" in p_type
            entity_name = entity or (
                p_type.replace("Repository<", "").replace(">", "")
                if "Repository<" in p_type
                else None
            )
            if is_repo and entity_name:
                repo_param_to_entity[p_name] = entity_name
                if entity_name not in service_repo_entities:
                    service_repo_entities.append(entity_name)

    # 2. Parse imported entity symbols from service_code
    imported_entities: Set[str] = set()
    import_pattern = re.compile(
        r"import\s+\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"]", re.MULTILINE
    )
    for match in import_pattern.finditer(service_code):
        symbols = [s.strip() for s in match.group(1).split(",")]
        import_path = match.group(2)
        if (
            import_path.endswith(".entity")
            or ".entity" in import_path
            or "/entities/" in import_path
            or "/model/" in import_path
        ):
            for sym in symbols:
                clean_sym = sym.split()[0]
                if clean_sym:
                    imported_entities.add(clean_sym)

    # If no error_text provided, return all known service repo entities (or imported entities)
    if not error_text:
        return list(service_repo_entities) if service_repo_entities else list(imported_entities)

    matched_entities: List[str] = []

    # Check for repository parameter names mentioned in error (e.g. this.artistLocatesInAdressesRepository.softDelete)
    for p_name, entity in repo_param_to_entity.items():
        if re.search(rf"\b{re.escape(p_name)}\b", error_text):
            if entity not in matched_entities:
                matched_entities.append(entity)

    # Check for known entity names explicitly mentioned in error_text
    all_known_entities = list(dict.fromkeys(service_repo_entities + list(imported_entities)))
    for entity in all_known_entities:
        if re.search(rf"\b{re.escape(entity)}\b", error_text):
            if entity not in matched_entities:
                matched_entities.append(entity)

    # Check for Repository<Entity> in error_text
    for m in re.finditer(r"Repository<([A-Za-z0-9_]+)>", error_text):
        ent = m.group(1)
        if ent not in matched_entities:
            matched_entities.append(ent)

    # Check for TS error type references, e.g. "type 'X'" or "parameter of type 'X'"
    for m in re.finditer(
        r"(?:type|Property|parameter of type|assignable to parameter of type)\s+['\"]?([A-Za-z0-9_]+)['\"]?",
        error_text,
    ):
        ent = m.group(1)
        if ent in all_known_entities and ent not in matched_entities:
            matched_entities.append(ent)

    # If specific entities matched, return them
    if matched_entities:
        return matched_entities

    # Fallback: if error is repository/type error, provide all repository entities of the service
    if is_repository_or_type_error(error_text):
        if service_repo_entities:
            return list(service_repo_entities)
        if imported_entities:
            return list(imported_entities)

    return []


def find_entity_file(
    project_path: Path,
    entity_name: str,
    service_code: Optional[str] = None,
    service_path: Optional[Path] = None,
) -> Optional[Path]:
    """Locates the *.entity.ts file defining entity_name within project_path."""
    project_path = Path(project_path).resolve()

    # 1. Check imports in service_code
    if service_code:
        import_pattern = re.compile(
            rf"import\s+\{{[^}}]*\b{re.escape(entity_name)}\b[^}}]*\}}\s+from\s+['\"]([^'\"]+)['\"]",
            re.MULTILINE,
        )
        m = import_pattern.search(service_code)
        if m:
            imp_path = m.group(1)
            # Relative import
            if imp_path.startswith(".") and service_path:
                candidates = [
                    (service_path.parent / f"{imp_path}.ts").resolve(),
                    (service_path.parent / f"{imp_path}").resolve(),
                ]
                for cand in candidates:
                    if cand.is_file():
                        return cand
            else:
                # Absolute or baseUrl-relative import
                candidates = [
                    (project_path / "src" / f"{imp_path}.ts").resolve(),
                    (project_path / f"{imp_path}.ts").resolve(),
                    (project_path / "src" / imp_path).resolve(),
                    (project_path / imp_path).resolve(),
                ]
                for cand in candidates:
                    if cand.is_file():
                        return cand

    # 2. Look by filename pattern
    search_dirs = [project_path / "src", project_path]
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        patterns = [
            f"**/{entity_name}.entity.ts",
            f"**/{entity_name.lower()}.entity.ts",
            f"**/*{entity_name}*.entity.ts",
        ]
        for pat in patterns:
            for match in sdir.glob(pat):
                if match.is_file():
                    return match.resolve()

    # 3. Scan all *.entity.ts files for class declaration
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        for ent_file in sdir.glob("**/*.entity.ts"):
            if not ent_file.is_file():
                continue
            try:
                text = ent_file.read_text(encoding="utf-8")
                if re.search(rf"export\s+(?:default\s+)?class\s+{re.escape(entity_name)}\b", text):
                    return ent_file.resolve()
            except Exception:
                pass

    return None


def extract_class_body(code: str, class_name: Optional[str] = None) -> Tuple[str, str]:
    """Extracts the class name and inner body enclosed by balanced braces."""
    clean = re.sub(r"//.*", "", code)
    clean = re.sub(r"/\*[\s\S]*?\*/", "", clean)

    if class_name:
        pattern = re.compile(
            rf"(?:@Entity[^{{]*\n\s*)?export\s+(?:default\s+)?class\s+({re.escape(class_name)})\b[^{{]*\{{"
        )
    else:
        pattern = re.compile(
            r"(?:@Entity[^{{]*\n\s*)?export\s+(?:default\s+)?class\s+(\w+)\b[^{{]*\{{"
        )

    m = pattern.search(clean)
    if not m:
        return "", ""

    matched_name = m.group(1)
    start_idx = m.end() - 1  # at '{'
    depth = 0
    end_idx = start_idx
    for i in range(start_idx, len(clean)):
        if clean[i] == "{":
            depth += 1
        elif clean[i] == "}":
            depth -= 1
            if depth == 0:
                end_idx = i
                break

    body = clean[start_idx + 1 : end_idx]
    return matched_name, body


def parse_typeorm_entity(
    entity_file_path: Path, entity_name: Optional[str] = None
) -> Dict[str, Any]:
    """Parses a TypeORM *.entity.ts file and extracts its columns and relationships."""
    if not entity_file_path.exists():
        return {"class_name": entity_name or "", "fields": []}

    content = entity_file_path.read_text(encoding="utf-8")
    matched_name, body = extract_class_body(content, entity_name)
    if not body:
        return {"class_name": entity_name or "", "fields": []}

    RELATION_DECORATORS = {"ManyToOne", "OneToMany", "ManyToMany", "OneToOne"}
    COLUMN_DECORATORS = {
        "Column",
        "PrimaryGeneratedColumn",
        "PrimaryColumn",
        "CreateDateColumn",
        "UpdateDateColumn",
        "DeleteDateColumn",
        "VersionColumn",
    }

    fields = []
    idx = 0
    length = len(body)
    current_decorators = []

    while idx < length:
        while idx < length and body[idx].isspace():
            idx += 1
        if idx >= length:
            break

        # Check for decorator
        if body[idx] == "@":
            m = re.match(r"@([a-zA-Z0-9_]+)", body[idx:])
            if m:
                dec_name = m.group(1)
                idx += m.end()
                while idx < length and body[idx].isspace():
                    idx += 1
                if idx < length and body[idx] == "(":
                    depth = 1
                    idx += 1
                    while idx < length and depth > 0:
                        if body[idx] == "(":
                            depth += 1
                        elif body[idx] == ")":
                            depth -= 1
                        idx += 1
                current_decorators.append(dec_name)
                continue

        rest = body[idx:]

        # Skip constructor
        ctor_match = re.match(r"^constructor\s*\([^{;]*\{", rest)
        if ctor_match:
            current_decorators = []
            idx += ctor_match.end()
            depth = 1
            while idx < length and depth > 0:
                if body[idx] == "{":
                    depth += 1
                elif body[idx] == "}":
                    depth -= 1
                idx += 1
            continue

        # Skip methods / getters with balanced braces
        method_match = re.match(
            r"^(?:get\s+|set\s+|async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)[^{;]*\{", rest
        )
        if method_match:
            current_decorators = []
            idx += method_match.end()
            depth = 1
            while idx < length and depth > 0:
                if body[idx] == "{":
                    depth += 1
                elif body[idx] == "}":
                    depth -= 1
                idx += 1
            continue

        # Check for property declaration: name: type;
        prop_match = re.match(
            r"^(?:public|private|protected)?\s*(?:readonly)?\s*([a-zA-Z0-9_$]+)(\?)?\s*:\s*([^;={\n]+)",
            rest,
        )
        if prop_match:
            prop_name = prop_match.group(1)
            is_opt = bool(prop_match.group(2))
            prop_type = prop_match.group(3).strip()

            has_col = any(d in COLUMN_DECORATORS for d in current_decorators)
            has_rel = any(d in RELATION_DECORATORS for d in current_decorators)

            # Record if it has TypeORM decorators or if decorators list is present
            if has_col or has_rel or current_decorators:
                fields.append({
                    "name": prop_name + ("?" if is_opt else ""),
                    "type": prop_type,
                    "is_relation": has_rel,
                })
            current_decorators = []
            idx += prop_match.end()
            while idx < length and body[idx] not in (";", "\n"):
                idx += 1
            if idx < length and body[idx] == ";":
                idx += 1
            continue

        idx += 1

    return {"class_name": matched_name, "fields": fields}


def format_entity_schema_block(
    entity_file_rel_path: str, fields: List[Dict[str, Any]]
) -> str:
    """Formats an entity's schema into the exact markdown/text block required for prompt injection."""
    lines = [
        "[CONTEXTO DE ENTIDADE INJETADO DEVIDO A ERRO NO JEST]",
        f"Arquivo: {entity_file_rel_path}",
        "Estrutura da Entidade:",
    ]
    for f in fields:
        rel_suffix = " (relation)" if f.get("is_relation") else ""
        lines.append(f"- {f['name']}: {f['type']}{rel_suffix}")
    return "\n".join(lines)


def extract_entity_schema_from_service(
    project_path: Union[Path, str],
    service_file: Union[Path, str],
    error_text: str = "",
    service_code: Optional[str] = None,
) -> str:
    """Dynamically extracts TypeORM entity schemas when Jest/TypeScript fails on repository/type errors."""
    project_path = Path(project_path).resolve()
    service_file_path = (
        Path(service_file)
        if Path(service_file).is_absolute()
        else (project_path / service_file).resolve()
    )

    if service_code is None:
        if service_file_path.exists():
            service_code = service_file_path.read_text(encoding="utf-8")
        else:
            service_code = ""

    if error_text and not is_repository_or_type_error(error_text):
        return ""

    entities = identify_failed_entities(error_text, service_code)
    if not entities:
        return ""

    blocks = []
    seen_entities = set()
    for ent_name in entities:
        if ent_name in seen_entities:
            continue
        seen_entities.add(ent_name)

        ent_file = find_entity_file(project_path, ent_name, service_code, service_file_path)
        if not ent_file or not ent_file.exists():
            continue

        parsed = parse_typeorm_entity(ent_file, ent_name)
        if not parsed["fields"]:
            continue

        try:
            rel_path = ent_file.relative_to(project_path)
        except ValueError:
            rel_path = ent_file

        block = format_entity_schema_block(str(rel_path), parsed["fields"])
        blocks.append(block)

    return "\n\n".join(blocks)


class TaskWorker:
    def __init__(
        self,
        model: str = "ollama/qwen2.5-coder:14b",
        timeout_seconds: int = 360,
        min_line_coverage: float = 60.0,
        log_level: str = "compact",
        allow_git_commit: bool = True,
    ):
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.min_line_coverage = min_line_coverage
        self.log_level = log_level.lower()  # 'quiet', 'compact', 'verbose'
        self.allow_git_commit = allow_git_commit

    def is_verbose(self) -> bool:
        return self.log_level == "verbose"

    def is_quiet(self) -> bool:
        return self.log_level == "quiet"

    def run_command(self, cmd: list, cwd: Path, timeout: Optional[int] = None) -> Tuple[int, str, str]:
        env = os.environ.copy()
        env["OLLAMA_NUM_CTX"] = "8192"
        env["BROWSER"] = "/usr/bin/true"
        env_file = Path(__file__).resolve().parent.parent / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
        try:
            result = subprocess.run(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True,
                timeout=timeout or self.timeout_seconds,
                env=env,
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return 124, "", f"Command timed out after {timeout or self.timeout_seconds} seconds"
        except Exception as e:
            return 1, "", str(e)

    def execute_task(self, task: Task, queue_manager: QueueManager) -> bool:
        project_path = Path(task.project_path).resolve()
        service_file_path = project_path / task.service_file
        spec_file_path = project_path / task.spec_file

        profile = registry.get_profile_by_name(task.profile) or registry.detect_profile(project_path)

        print(f"\n=======================================================")
        print(f"[{task.id}] Processing: {task.service_file}")
        print(f"Target Spec: {task.spec_file}")
        print(f"Framework Profile: {profile.name}")
        print(f"Module: {task.module_name}")
        print(f"=======================================================")

        if not service_file_path.exists():
            error_msg = f"Source file not found: {service_file_path}"
            print(f"ERROR: {error_msg}")
            queue_manager.update_task_status(task.id, "failed", error_log=error_msg)
            return False

        initial_service_hash = get_file_hash(service_file_path)

        # Deterministic Scaffolding & Type Context Extraction
        initial_scaffold = None
        type_context = ""
        rehydrated = False
        quarantine_file = Path(__file__).resolve().parent.parent / "reports" / "quarantine" / task.module_name / spec_file_path.name

        if profile.name == "nestjs":
            try:
                from pipeline.scaffolder import NestJSScaffolder
                scaffolder = NestJSScaffolder()
                service_code = service_file_path.read_text(encoding="utf-8")
                initial_scaffold = scaffolder.generate_scaffold(service_file_path, service_code)
                type_context = scaffolder.extract_imported_type_context(project_path, service_file_path, service_code)

                if quarantine_file.exists() and (not spec_file_path.exists() or spec_file_path.stat().st_size < 150):
                    print(f"📦 [REHYDRATE]: Restoring quarantined spec from {quarantine_file}...")
                    spec_file_path.parent.mkdir(parents=True, exist_ok=True)
                    restored_code = sanitize_mock_types(quarantine_file.read_text(encoding="utf-8"))
                    spec_file_path.write_text(restored_code, encoding="utf-8")
                    rehydrated = True
                elif not spec_file_path.exists() or spec_file_path.stat().st_size < 150:
                    print(f"⚡ [ZERO-AI] Generating deterministic test scaffold with mocked providers...")
                    spec_file_path.parent.mkdir(parents=True, exist_ok=True)
                    spec_file_path.write_text(initial_scaffold, encoding="utf-8")
                    print(f"⚡ [ZERO-AI] Scaffold ready at {task.spec_file}")
            except Exception as e:
                print(f"Notice: Deterministic scaffolding skipped ({e})")

        golden_template = profile.get_golden_template(project_path)
        prompt_template_path = profile.get_prompt_template_path()
        with open(prompt_template_path, "r", encoding="utf-8") as f:
            prompt_template = f.read()

        base_prompt = prompt_template.format(
            service_file=task.service_file,
            spec_file=task.spec_file,
            golden_template=golden_template,
        )
        current_prompt = base_prompt + type_context
        attempt_history: List[str] = []

        queue_manager.update_task_status(task.id, "in_progress")
        current_model = self.model
        previous_error: Optional[str] = None
        last_passing_spec: Optional[str] = None
        last_passing_coverage: Optional[float] = None
        last_passing_score: Optional[QualityConfidenceScore] = None

        # Pre-flight check if rehydrated from quarantine
        if rehydrated and spec_file_path.exists():
            test_cmd = profile.get_test_command(task.spec_file, service_file=task.service_file)
            print(f"🔍 [REHYDRATE PRE-FLIGHT]: Running Jest on restored quarantine spec...")
            pre_code, pre_stdout, pre_stderr = self.run_command(test_cmd, cwd=project_path, timeout=60)
            if pre_code == 0:
                restored_text = spec_file_path.read_text(encoding="utf-8")
                pre_it_count = len(re.findall(r"\b(?:it|test)\s*\(", restored_text))
                if pre_it_count >= 2:
                    cov_m = parse_coverage_final_json(project_path, task.service_file)
                    line_cov = cov_m.line_pct if cov_m else parse_line_coverage(pre_stdout, task.service_file)
                    branch_cov = cov_m.branch_pct if cov_m else None
                    svc_text = service_file_path.read_text(encoding="utf-8") if service_file_path.exists() else ""
                    pre_score = calculate_quality_confidence_score(
                        line_coverage=line_cov,
                        branch_coverage=branch_cov,
                        negative_analysis=analyze_negative_branches(svc_text, restored_text),
                        sut_violation=check_anti_sut_mocking(restored_text),
                        attempt=1,
                    )
                    last_passing_spec = restored_text
                    last_passing_coverage = line_cov
                    last_passing_score = pre_score
                    if pre_score.passed:
                        print(f"✅ [REHYDRATE SUCCESS]: Quarantined spec passed with Score {pre_score.total_score:.1f}/100! (Lines: {line_cov}%)")
                        if self.allow_git_commit:
                            commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem} (Score: {pre_score.total_score:.0f})"
                            self.run_command(["git", "add", task.spec_file], cwd=project_path)
                            self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
                        queue_manager.update_task_status(task.id, "completed", increment_attempt=False)
                        return True
                    else:
                        print(f"⚠️ [REHYDRATE WARNING]: Quarantined spec passed Jest but Quality Score {pre_score.total_score:.1f}/100 < 70.0. Proceeding to AI refinement...")
            else:
                pre_error = (pre_stdout + "\n" + pre_stderr).strip()
                error_traceback = pre_error
                unpruned_text = spec_file_path.read_text(encoding="utf-8")
                pruned_pre = prune_failing_tests(unpruned_text, pre_error)
                if pruned_pre:
                    spec_file_path.write_text(pruned_pre, encoding="utf-8")
                    p_code, p_stdout, _ = self.run_command(test_cmd, cwd=project_path, timeout=60)
                    if p_code == 0:
                        cov_m = parse_coverage_final_json(project_path, task.service_file)
                        p_cov = cov_m.line_pct if cov_m else parse_line_coverage(p_stdout, task.service_file)
                        p_br = cov_m.branch_pct if cov_m else None
                        svc_text = service_file_path.read_text(encoding="utf-8") if service_file_path.exists() else ""
                        p_score = calculate_quality_confidence_score(
                            line_coverage=p_cov,
                            branch_coverage=p_br,
                            negative_analysis=analyze_negative_branches(svc_text, pruned_pre),
                            sut_violation=check_anti_sut_mocking(pruned_pre),
                            attempt=1,
                        )
                        last_passing_spec = pruned_pre
                        last_passing_coverage = p_cov if p_cov is not None else 25.0
                        last_passing_score = p_score
                        if p_score.passed:
                            print(f"✅ [ZERO-SHOT PRUNED]: Quarantined spec passed with Score {p_score.total_score:.1f}/100 after pruning broken test block!")
                            self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)
                            if self.allow_git_commit:
                                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem} (Score: {p_score.total_score:.0f})"
                                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
                            queue_manager.update_task_status(task.id, "completed", increment_attempt=False)
                            return True
                        print(f"🛡️ [PRE-FLIGHT BASELINE]: Secured {last_passing_coverage:.1f}% passing baseline via auto-pruner before AI refinement.")
                    spec_file_path.write_text(unpruned_text, encoding="utf-8")

                schema_context = ""
                try:
                    service_content = (
                        service_file_path.read_text(encoding="utf-8")
                        if service_file_path.exists()
                        else None
                    )
                    schema_context = extract_entity_schema_from_service(
                        project_path=project_path,
                        service_file=task.service_file,
                        error_text=pre_error,
                        service_code=service_content,
                    )
                    if schema_context and schema_context not in type_context:
                        type_context = f"{type_context}\n\n{schema_context}"
                except Exception:
                    pass

                schema_section = f"\n\n{schema_context}" if schema_context else ""
                current_prompt = (
                    f"O arquivo de teste `{task.spec_file}` já possui a estrutura de testes criada, mas falhou no Jest com o seguinte erro:\n\n"
                    f"```\n{pre_error[-1500:]}\n```"
                    f"{schema_section}\n\n"
                    f"Por favor, corrija APENAS os erros de tipagem, imports ou mocks que falharam em `{task.spec_file}` mantendo os testes que já funcionam. "
                    f"Use `as any` para objetos parciais de mock se o TypeScript reclamar de propriedades faltantes. "
                    f"NÃO modifique `{task.service_file}` e NUNCA mocke o próprio serviço."
                    + type_context
                )

        for attempt in range(1, task.max_attempts + 1):
            print(f"--- Attempt {attempt}/{task.max_attempts} for {task.id} ---")

            # Self-healing safeguard: if spec file is truncated or corrupt (< 150 bytes), restore clean scaffold
            if initial_scaffold and (not spec_file_path.exists() or spec_file_path.stat().st_size < 150):
                print(f"⚡ [RESTORE] Restoring clean deterministic scaffold before attempt {attempt}...")
                spec_file_path.write_text(initial_scaffold, encoding="utf-8")

            # Log prompt context sent to model
            if self.is_verbose():
                print(f"📋 [PROMPT CONTEXT]: Total size {len(current_prompt)} chars (Base Template: {len(base_prompt)} chars)")
                if attempt_history:
                    print("🧠 [FEEDBACK REPASSADO AO MODELO]:")
                    print("   ↳ Histórico de Falhas Anteriores:")
                    for h in attempt_history:
                        print(f"      • {h}")
                    if "surgical_instruction_preview" in locals():
                        print(f"   ↳ Instrução Cirúrgica Atual:\n{surgical_instruction_preview}")
                else:
                    print("🌱 [PRIMEIRA TENTATIVA]: Enviando Golden Template e scaffold inicial.")
            elif not self.is_quiet() and attempt_history:
                last_hist = attempt_history[-1].replace('\n', ' ')
                if len(last_hist) > 120:
                    last_hist = last_hist[:117] + "..."
                print(f"🧠 [FEEDBACK]: Refinando tentativa com base em: {last_hist}")

            aider_cmd = [
                "aider",
                "--model", current_model,
                "--read", str(service_file_path),
                "--file", str(spec_file_path),
                "--message", current_prompt,
                "--yes",
                "--no-detect-urls",
                "--no-auto-commits",
                "--no-show-model-warnings",
                "--no-attribute-author",
                "--no-attribute-committer",
                "--map-tokens", "0",
            ]

            pre_aider_spec_hash = get_file_hash(spec_file_path)
            print(f"Calling Aider with model: {current_model}...")
            start_time = time.time()
            ret_code, stdout, stderr = self.run_command(aider_cmd, cwd=project_path)
            duration = time.time() - start_time
            print(f"Aider finished in {duration:.1f}s (Exit code: {ret_code})")
            post_aider_spec_hash = get_file_hash(spec_file_path)

            # Intelligent Rate Limit (429) & Instant Dual-Cloud Failover
            combined_output = stdout + "\n" + stderr
            if any(err in combined_output for err in ["RateLimitError", "rate_limit_exceeded", "RESOURCE_EXHAUSTED", "code\": 429"]):
                print(f"⚠️ [RATE LIMIT DETECTED on {current_model}]")
                if current_model.startswith("groq/"):
                    current_model = "gemini/gemini-2.5-flash"
                elif current_model.startswith("gemini/"):
                    current_model = "groq/openai/gpt-oss-120b"
                print(f"🔄 [PROVIDER ROTATION]: Failover target model: {current_model}")

                if post_aider_spec_hash == pre_aider_spec_hash:
                    print("⏩ Aider aborted before modifying spec due to rate limit. Retrying immediate failover with rotated provider...")
                    time.sleep(8)
                    aider_failover_cmd = list(aider_cmd)
                    aider_failover_cmd[2] = current_model
                    _, fo_stdout, fo_stderr = self.run_command(aider_failover_cmd, cwd=project_path)
                    post_aider_spec_hash = get_file_hash(spec_file_path)
                    combined_output = fo_stdout + "\n" + fo_stderr
                    if post_aider_spec_hash == pre_aider_spec_hash:
                        print("⚠️ Failover provider also throttled. Cooling down 15s before next attempt...")
                        time.sleep(15)
                        continue
                    else:
                        print(f"✅ Failover with {current_model} successfully modified spec! Proceeding to verification...")
                else:
                    print("✅ Aider modified the spec despite rate-limit warning! Proceeding to Jest verification...")

            # Deterministic Mechanical Sanitizer & Formatter (Zero-AI)
            if spec_file_path.exists():
                try:
                    raw_spec = spec_file_path.read_text(encoding="utf-8")
                    cleaned_spec = sanitize_mock_types(raw_spec)
                    if cleaned_spec != raw_spec:
                        spec_file_path.write_text(cleaned_spec, encoding="utf-8")
                except Exception:
                    pass
                self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)

            # Guardrail 1: Immutability of Production Code
            current_service_hash = get_file_hash(service_file_path)
            if current_service_hash != initial_service_hash:
                print("⚠️ [ANTI-CHEAT GUARDRAIL TRIGGERED] Production source file was modified! Reverting...")
                self.run_command(["git", "checkout", "--", task.service_file], cwd=project_path)

            # Guardrail 2: Static Anti-SUT Mock Check (Khorikov Rule)
            if spec_file_path.exists():
                spec_content = spec_file_path.read_text(encoding="utf-8")
                sut_violation = check_anti_sut_mocking(spec_content)
                if sut_violation:
                    print(f"🛑 [QUALITY GATE REJECTION]: {sut_violation}")
                    attempt_history.append(
                        f"Tentativa {attempt}: Violação Khorikov SUT - método do próprio serviço foi mockado. NUNCA mocke o método que está sendo testado!"
                    )
                    sut_instruction = (
                        f"{sut_violation}\n\n"
                        f"AÇÃO OBRIGATÓRIA: Remova qualquer `spyOn` ou `jest.fn()` na própria instância do serviço `{task.service_file}`. "
                        f"Chame o método real do serviço com `await service.<metodo>(...)` e mocke EXCLUSIVAMENTE os repositórios/serviços injetados no construtor."
                    )
                    current_prompt = format_refinement_prompt(
                        base_prompt, attempt_history, sut_instruction, type_context
                    )
                    queue_manager.update_task_status(
                        task.id, "in_progress", error_log=sut_violation, increment_attempt=True
                    )
                    continue

            # Guardrail 3: Quality Gate via Native Test Runner + Line Coverage Check
            test_cmd = profile.get_test_command(task.spec_file, service_file=task.service_file)
            print(f"Running test verification via {profile.name} ({' '.join(test_cmd)})...")
            test_code, test_stdout, test_stderr = self.run_command(test_cmd, cwd=project_path, timeout=60)

            if test_code == 0:
                spec_now = spec_file_path.read_text(encoding="utf-8") if spec_file_path.exists() else ""
                it_count = len(re.findall(r"\b(?:it|test)\s*\(", spec_now))
                todo_count = len(re.findall(r"//\s*TODO:", spec_now))

                if it_count <= 1:
                    methods_in_spec = re.findall(r"describe\('(\w+)'", spec_now)
                    methods_list = ", ".join(methods_in_spec) if methods_in_spec else "todos os métodos públicos"
                    shallow_msg = (
                        f"🛑 SUÍTE SUPERFICIAL REJEITADA: O arquivo `{task.spec_file}` contém apenas {it_count} teste "
                        f"(`should be defined`) e {todo_count} bloco(s) `// TODO`.\n\n"
                        f"AÇÃO OBRIGATÓRIA:\n"
                        f"1. Você DEVE substituir IMEDIATAMENTE todos os comentários `// TODO` dentro de cada bloco `describe()` por testes reais `it('should ...', async () => {{ ... }})`.\n"
                        f"2. Métodos a serem testados: `{methods_list}`.\n"
                        f"3. Para cada método, crie pelo menos 1 teste de sucesso (chamando `await service.<metodo>(...)` e verificando o retorno) e 1 teste com filtros/tratamento de erro.\n"
                        f"4. NUNCA deixe nenhum bloco `describe` vazio sem blocos `it(...)`."
                    )
                    print(f"🛑 [SHALLOW SPEC REJECTED]: Only {it_count} test found in {task.spec_file}. Demanding implementation of {methods_list}.")
                    attempt_history.append(
                        f"Tentativa {attempt}: Teste superficial rejeitado com apenas {it_count} teste. Falta implementar testes reais para: {methods_list}."
                    )
                    surgical_instruction_preview = shallow_msg
                    current_prompt = format_refinement_prompt(
                        base_prompt, attempt_history, shallow_msg, type_context
                    )
                    continue

                # Check line coverage via coverage-final.json reader (with text table fallback)
                cov_metrics = parse_coverage_final_json(project_path, task.service_file)
                line_cov = cov_metrics.line_pct if cov_metrics else parse_line_coverage(test_stdout, task.service_file)
                branch_cov = cov_metrics.branch_pct if cov_metrics else None

                service_content = service_file_path.read_text(encoding="utf-8") if service_file_path.exists() else ""
                neg_analysis = analyze_negative_branches(service_content, spec_now)
                sut_violation = check_anti_sut_mocking(spec_now)

                score = calculate_quality_confidence_score(
                    line_coverage=line_cov,
                    branch_coverage=branch_cov,
                    negative_analysis=neg_analysis,
                    sut_violation=sut_violation,
                    attempt=attempt,
                )

                if spec_file_path.exists():
                    last_passing_spec = spec_now
                    last_passing_coverage = line_cov
                    last_passing_score = score

                if not score.passed:
                    reasons_str = "; ".join(score.details.get("failure_reasons", []))
                    print(
                        f"🛑 [QUALITY GATE REJECTION]: Jest passou (código 0), mas a suíte foi REPROVADA "
                        f"no Quality Gate com score {score.total_score:.1f}/100 (mínimo exigido: 70.0).\n"
                        f"   ↳ {score.summary()}\n"
                        f"   ↳ Motivos: {reasons_str}"
                    )
                    attempt_history.append(
                        f"Tentativa {attempt}: Jest passou, mas o Quality Confidence Score foi {score.total_score:.1f}/100 (< 70). Motivos: {reasons_str}"
                    )

                    # Build targeted surgical instructions based on which pillar failed
                    guidance = []
                    if score.coverage_score < 40.0:
                        uncovered_info = ""
                        if cov_metrics and cov_metrics.uncovered_lines:
                            uncovered_info = f" Linhas descobertas: {_format_line_ranges(cov_metrics.uncovered_lines)}."
                        guidance.append(
                            f"1. Aumente a cobertura de linhas (atual: {line_cov:.1f}%, meta >= 75%).{uncovered_info}"
                        )
                    if not neg_analysis.has_negative_branches:
                        guidance.append(
                            f"2. OBRIGATÓRIO (Negative Branch Enforcement): Adicione testes verificando cenários de erro "
                            f"com `await expect(service.<metodo>(...)).rejects.toThrow()` para os seguintes métodos públicos que lançam exceções: "
                            f"`{', '.join(neg_analysis.uncovered_methods)}`."
                        )
                    if score.anti_sut_score < 20.0:
                        guidance.append(
                            f"3. NUNCA mocke a própria classe/método do serviço sob teste. Mocke apenas as dependências injetadas."
                        )

                    gate_instruction = (
                        f"O teste unitário em `{task.spec_file}` passou na execução do Jest, mas foi REPROVADO no Quality Gate com score {score.total_score:.1f}/100 (mínimo 70.0).\n\n"
                        f"{score.summary()}\n\n"
                        f"AÇÕES OBRIGATÓRIAS PARA ATINGIR O SCORE MÍNIMO:\n"
                        + "\n".join(guidance)
                        + f"\n\nPor favor, expanda `{task.spec_file}` atendendo aos pontos acima mantendo os testes que já passam."
                    )
                    surgical_instruction_preview = gate_instruction
                    current_prompt = format_refinement_prompt(
                        base_prompt, attempt_history, gate_instruction, type_context
                    )
                    queue_manager.update_task_status(
                        task.id,
                        "in_progress",
                        error_log=f"Quality Gate Score {score.total_score:.1f}/100 (< 70): {reasons_str}",
                        increment_attempt=True,
                    )
                    continue

                print(f"✅ SUCCESS! High-quality unit tests verified for {task.service_file}")
                print(f"   ↳ {score.summary()}")

                if self.allow_git_commit:
                    commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem} (Score: {score.total_score:.0f})"
                    self.run_command(["git", "add", task.spec_file], cwd=project_path)
                    self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)

                queue_manager.update_task_status(task.id, "completed", increment_attempt=True)
                return True
            else:
                error_traceback = (test_stdout + "\n" + test_stderr).strip()
                if not self.is_quiet():
                    print(f"❌ Test verification failed on attempt {attempt} (Exit code: {test_code}).")
                    if self.is_verbose():
                        print("===================== [VERIFICATION ERROR LOG (VERBOSE)] =====================")
                        print(error_traceback[-2500:] if len(error_traceback) > 2500 else error_traceback)
                        print("==============================================================================\n")
                    else:
                        # Compact mode: print only the relevant failure message or last lines
                        compact_err = error_traceback[-400:].strip()
                        print(f"   ↳ [ERROR RESUMO]: {compact_err}\n")

                # Repetition Circuit Breaker
                if previous_error and error_traceback[-250:] == previous_error[-250:]:
                    print(f"⚡ [CIRCUIT BREAKER]: Identical error repeated on attempt {attempt}. Escalating provider to break loop...")
                    if current_model.startswith("groq/"):
                        current_model = "gemini/gemini-2.5-flash"
                    elif current_model.startswith("gemini/"):
                        current_model = "groq/openai/gpt-oss-120b"
                previous_error = error_traceback

                queue_manager.update_task_status(
                    task.id,
                    "in_progress",
                    error_log=error_traceback[-1000:],
                    increment_attempt=True,
                )

                attempt_history.append(
                    f"Tentativa {attempt}: Falha de execução no Jest:\n  ↳ {error_traceback[-250:].strip()}"
                )

                # Dynamic TypeORM Schema Extraction and Injection on Error
                schema_context = ""
                try:
                    service_content = (
                        service_file_path.read_text(encoding="utf-8")
                        if service_file_path.exists()
                        else None
                    )
                    schema_context = extract_entity_schema_from_service(
                        project_path=project_path,
                        service_file=task.service_file,
                        error_text=error_traceback,
                        service_code=service_content,
                    )
                    if schema_context:
                        print(
                            f"💉 [SCHEMA INJECTION]: Injected TypeORM entity schema into refinement prompt:\n{schema_context}"
                        )
                        if schema_context not in type_context:
                            type_context = f"{type_context}\n\n{schema_context}"
                except Exception as e:
                    if self.is_verbose():
                        print(f"Notice: Schema injection extraction skipped ({e})")

                schema_section = f"\n\n{schema_context}" if schema_context else ""
                jest_instruction = (
                    f"O teste unitário em `{task.spec_file}` falhou com o seguinte erro:\n\n"
                    f"```\n{error_traceback[-1500:]}\n```"
                    f"{schema_section}\n\n"
                    f"Por favor, ajuste EXCLUSIVAMENTE o arquivo `{task.spec_file}` para corrigir os mocks ou asserções e fazer todos os testes passarem. "
                    f"Use `as any` em objetos parciais de mock se houver erro TS2345/TS2339. "
                    f"Lembre-se: NÃO modifique `{task.service_file}` e NUNCA mocke o próprio serviço."
                )
                surgical_instruction_preview = jest_instruction
                current_prompt = format_refinement_prompt(
                    base_prompt, attempt_history, jest_instruction, type_context
                )

        print(f"🚨 Exhausted all {task.max_attempts} attempts for {task.id}.")

        # Preservation Strategy 0: Faulty-Test Auto-Pruner (Salvage passing tests by pruning broken it() blocks)
        if not last_passing_spec and spec_file_path.exists() and "error_traceback" in locals():
            original_spec = spec_file_path.read_text(encoding="utf-8")
            pruned_spec = prune_failing_tests(original_spec, error_traceback)
            if pruned_spec:
                print(f"✂️ [AUTO-PRUNER]: Attempting to salvage passing tests by removing failing it() blocks...")
                spec_file_path.write_text(pruned_spec, encoding="utf-8")
                test_cmd = profile.get_test_command(task.spec_file, service_file=task.service_file)
                p_code, p_stdout, _ = self.run_command(test_cmd, cwd=project_path, timeout=60)
                if p_code == 0:
                    cov_m = parse_coverage_final_json(project_path, task.service_file)
                    p_cov = cov_m.line_pct if cov_m else parse_line_coverage(p_stdout, task.service_file)
                    p_br = cov_m.branch_pct if cov_m else None
                    svc_text = service_file_path.read_text(encoding="utf-8") if service_file_path.exists() else ""
                    p_score = calculate_quality_confidence_score(
                        line_coverage=p_cov,
                        branch_coverage=p_br,
                        negative_analysis=analyze_negative_branches(svc_text, pruned_spec),
                        sut_violation=check_anti_sut_mocking(pruned_spec),
                        attempt=task.max_attempts,
                    )
                    if p_score.passed:
                        print(f"✅ [AUTO-PRUNER]: Salvaged passing test suite with Score {p_score.total_score:.1f}/100!")
                        last_passing_spec = pruned_spec
                        last_passing_coverage = p_cov
                        last_passing_score = p_score
                    else:
                        print(f"⚠️ [AUTO-PRUNER]: Pruned test passed Jest but Quality Score {p_score.total_score:.1f} < 70.")
                        spec_file_path.write_text(original_spec, encoding="utf-8")
                else:
                    spec_file_path.write_text(original_spec, encoding="utf-8")

        # Preservation Strategy 1: Preserve verified test suite ONLY if Quality Score >= 70
        if last_passing_spec and "last_passing_score" in locals() and last_passing_score and last_passing_score.passed:
            print(f"🛡️ [PRESERVATION]: Preserving verified test suite with Score {last_passing_score.total_score:.1f}/100.")
            spec_file_path.write_text(last_passing_spec, encoding="utf-8")
            self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)
            if self.allow_git_commit:
                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem} (Score: {last_passing_score.total_score:.0f})"
                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
            queue_manager.update_task_status(task.id, "completed", increment_attempt=True)
            return True

        # Preservation Strategy 2: Quarantine failed / sub-threshold spec for human review
        # (REGRA DE BLOQUEIO: Suítes com score < 70 são enviadas para quarentena mesmo se o Jest sair com código 0)
        quarantine_dir = Path(__file__).resolve().parent.parent / "reports" / "quarantine" / task.module_name
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        score_info = f" (Score: {last_passing_score.total_score:.1f}/100 < 70)" if "last_passing_score" in locals() and last_passing_score else ""
        if spec_file_path.exists():
            quarantine_file = quarantine_dir / spec_file_path.name
            quarantine_file.write_text(spec_file_path.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"📦 [QUARANTINE]: Saved unverified / sub-threshold spec to {quarantine_file}{score_info}")
            spec_file_path.unlink()
        elif last_passing_spec:
            quarantine_file = quarantine_dir / spec_file_path.name
            quarantine_file.write_text(last_passing_spec, encoding="utf-8")
            print(f"📦 [QUARANTINE]: Saved passing but sub-threshold spec to {quarantine_file}{score_info}")

        if self.allow_git_commit:
            self.run_command(["git", "restore", "--staged", task.spec_file], cwd=project_path)

        if "last_passing_score" in locals() and last_passing_score and not last_passing_score.passed:
            reasons = "; ".join(last_passing_score.details.get("failure_reasons", []))
            last_error = f"Quality Confidence Score {last_passing_score.total_score:.1f}/100 reprovado (< 70): {reasons}"
        else:
            last_error = error_traceback[-500:] if "error_traceback" in locals() else "Unknown failure"

        queue_manager.update_task_status(
            task.id,
            "failed",
            error_log=f"Failed after {task.max_attempts} attempts. Last error: {last_error}",
        )
        return False
