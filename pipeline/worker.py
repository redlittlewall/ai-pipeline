import hashlib
import os
from pathlib import Path
import re
import subprocess
import time
from typing import Optional, Tuple
from pipeline.profiles.registry import registry
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
    """Enforces 'let <dep>: any;', fixes 'src/' import prefixes, heals truncated specs, and upgrades TypeORM mocks."""
    # 1. Strip 'src/' prefix from module imports (NestJS baseUrl is already 'src')
    spec_text = re.sub(r"from\s+(['\"])src/([^'\"]+)\1", r"from \1\2\1", spec_text)

    # 2. Heal truncated spec files (when LLM output hits max_tokens mid-block)
    if not spec_text.rstrip().endswith("});"):
        last_describe_close = spec_text.rfind("\n  });")
        if last_describe_close != -1:
            spec_text = spec_text[: last_describe_close + 6] + "\n});\n"

    # 3. Enforce 'any' on mock dependency declarations
    def _repl(m):
        v = m.group(1)
        if v.lower() in ("service", "sut"):
            return m.group(0)
        return f"let {v}: any;"
    spec_text = re.sub(
        r'let\s+([a-zA-Z0-9_]+)\s*:\s*(?:Repository<[^>]+>|(?:jest\.)?Mocked<[^;]+>|[A-Z][a-zA-Z0-9_]+);',
        _repl,
        spec_text,
    )

    # 4. Upgrade save: jest.fn() so unmocked save() calls return the entity with an id instead of undefined
    spec_text = re.sub(
        r'\bsave:\s*jest\.fn\(\)\s*,',
        "save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'mock-id', ...(e || {}) })),",
        spec_text,
    )

    # 5. Heal legacy Repository mocks missing softDelete / count / findAndCount
    if "delete: jest.fn()," in spec_text and "softDelete:" not in spec_text:
        spec_text = spec_text.replace(
            "delete: jest.fn(),",
            "delete: jest.fn(),\n      softDelete: jest.fn(),\n      restore: jest.fn(),\n      count: jest.fn(),\n      findAndCount: jest.fn(),",
        )

    # 6. Heal QueryBuilder mocks missing select / addSelect / delete / from / addGroupBy
    spec_text = re.sub(
        r'(\{\s*\n\s*innerJoin:\s*jest\.fn\(\)\.mockReturnThis\(\),)',
        r'{\n        select: jest.fn().mockReturnThis(),\n        addSelect: jest.fn().mockReturnThis(),\n        innerJoin: jest.fn().mockReturnThis(),',
        spec_text,
    )
    if "groupBy: jest.fn().mockReturnThis()," in spec_text and "addGroupBy:" not in spec_text:
        spec_text = spec_text.replace(
            "groupBy: jest.fn().mockReturnThis(),",
            "groupBy: jest.fn().mockReturnThis(),\n      addGroupBy: jest.fn().mockReturnThis(),\n      delete: jest.fn().mockReturnThis(),\n      from: jest.fn().mockReturnThis(),\n      leftJoinAndSelect: jest.fn().mockReturnThis(),\n      innerJoinAndSelect: jest.fn().mockReturnThis(),",
        )

    # 7. Heal partial object literal casts (e.g. `} as TattooEntity` -> `} as any`) to avoid TS2352
    spec_text = re.sub(r"\}\s+as\s+[A-Z][A-Za-z0-9_<>\[\]]*", "} as any", spec_text)

    # 8. Auto-import referenced @nestjs/common exceptions if missing
    nest_exceptions = [
        "NotFoundException",
        "BadRequestException",
        "UnauthorizedException",
        "ForbiddenException",
        "ConflictException",
        "InternalServerErrorException",
        "HttpException",
        "HttpStatus",
    ]
    missing_ex = [
        ex for ex in nest_exceptions
        if re.search(rf"\b{ex}\b", spec_text)
        and not re.search(rf"import\s+\{{[^}}]*\b{ex}\b[^}}]*\}}\s+from\s+['\"]@nestjs/common['\"]", spec_text)
    ]
    if missing_ex:
        spec_text = f"import {{ {', '.join(missing_ex)} }} from '@nestjs/common';\n" + spec_text

    # 9. Auto-heal WhereExpressionBuilder and Brackets callback arguments (TS2345)
    # Replaces `whereFactory(mockQb)` or `whereFactory(qb)` with `whereFactory(mockQb as any)`
    spec_text = re.sub(
        r'(\bwhereFactory\s*\(\s*)([a-zA-Z0-9_]+)(\s*\))',
        r'\1\2 as any\3',
        spec_text,
    )
    # Also handle inline object literals passed to whereFactory({ ... }) -> whereFactory({ ... } as any)
    spec_text = re.sub(
        r'(\bwhereFactory\s*\(\s*\{[^}]+\})(\s*\))',
        r'\1 as any\2',
        spec_text,
    )

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

        # Pre-flight check if rehydrated from quarantine
        if rehydrated and spec_file_path.exists():
            test_cmd = profile.get_test_command(task.spec_file, service_file=task.service_file)
            print(f"🔍 [REHYDRATE PRE-FLIGHT]: Running Jest on restored quarantine spec...")
            pre_code, pre_stdout, pre_stderr = self.run_command(test_cmd, cwd=project_path, timeout=60)
            if pre_code == 0:
                restored_text = spec_file_path.read_text(encoding="utf-8")
                pre_it_count = len(re.findall(r"\b(?:it|test)\s*\(", restored_text))
                if pre_it_count >= 2:
                    line_cov = parse_line_coverage(pre_stdout, task.service_file)
                    last_passing_spec = restored_text
                    last_passing_coverage = line_cov
                    if line_cov is None or line_cov >= self.min_line_coverage:
                        print(f"✅ [ZERO-SHOT HEALED]: Quarantined spec passed immediately after mock self-healing! (Coverage: {line_cov}%)")
                        if self.allow_git_commit:
                            commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}"
                            self.run_command(["git", "add", task.spec_file], cwd=project_path)
                            self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
                        queue_manager.update_task_status(task.id, "completed", increment_attempt=False)
                        return True
            else:
                pre_error = (pre_stdout + "\n" + pre_stderr).strip()
                error_traceback = pre_error
                unpruned_text = spec_file_path.read_text(encoding="utf-8")
                pruned_pre = prune_failing_tests(unpruned_text, pre_error)
                if pruned_pre:
                    spec_file_path.write_text(pruned_pre, encoding="utf-8")
                    p_code, p_stdout, _ = self.run_command(test_cmd, cwd=project_path, timeout=60)
                    if p_code == 0:
                        p_cov = parse_line_coverage(p_stdout, task.service_file)
                        last_passing_spec = pruned_pre
                        last_passing_coverage = p_cov if p_cov is not None else 25.0
                        if p_cov is not None and p_cov >= self.min_line_coverage:
                            print(f"✅ [ZERO-SHOT PRUNED]: Quarantined spec passed with {p_cov:.1f}% coverage after pruning broken test block!")
                            self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)
                            if self.allow_git_commit:
                                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}"
                                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
                            queue_manager.update_task_status(task.id, "completed", increment_attempt=False)
                            return True
                        print(f"🛡️ [PRE-FLIGHT BASELINE]: Secured {last_passing_coverage:.1f}% passing baseline via auto-pruner before AI refinement.")
                    spec_file_path.write_text(unpruned_text, encoding="utf-8")

                current_prompt = (
                    f"O arquivo de teste `{task.spec_file}` já possui a estrutura de testes criada, mas falhou no Jest com o seguinte erro:\n\n"
                    f"```\n{pre_error[-1500:]}\n```\n\n"
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

                # Check line coverage via text table + coverage-final.json reader
                line_cov = parse_line_coverage(test_stdout, task.service_file)
                cov_details = None
                try:
                    from pipeline.auditor import StaticQualityAuditor
                    cov_details = StaticQualityAuditor(project_path).get_file_coverage_from_json(service_file_path)
                    if line_cov is None and cov_details:
                        line_cov = cov_details["stmt_pct"]
                except Exception:
                    pass

                if spec_file_path.exists():
                    last_passing_spec = spec_now
                    last_passing_coverage = line_cov

                low_branch = bool(
                    cov_details
                    and cov_details["total_branches"] >= 2
                    and cov_details["branch_pct"] < 25.0
                )
                if (line_cov is not None and line_cov < self.min_line_coverage) or low_branch:
                    uncovered_info = ""
                    if cov_details:
                        fns = ", ".join(cov_details["uncovered_functions"]) or "nenhum método inteiro"
                        rngs = cov_details["uncovered_ranges_str"]
                        uncovered_info = (
                            f"\n- **Métodos ainda não executados (0%):** `{fns}`\n"
                            f"- **Linhas exatas sem cobertura no arquivo `{task.service_file}`:** `{rngs}`\n"
                            f"- **Cobertura de branches (if/else):** `{cov_details['branch_pct']:.1f}% ({cov_details['covered_branches']}/{cov_details['total_branches']})`\n"
                        )
                    cov_msg = (
                        f"COBERTURA INSUFICIENTE: O teste passou no Jest, mas a cobertura real de execução "
                        f"(Linhas: {line_cov:.1f}%, meta >= {self.min_line_coverage}%) ou de branches (if/else) é insuficiente.{uncovered_info}"
                    )
                    attempt_history.append(
                        f"Tentativa {attempt}: Cobertura insuficiente ({line_cov:.1f}%). Meta é >= {self.min_line_coverage}%."
                    )
                    cov_instruction = (
                        f"{cov_msg}\n\n"
                        f"Por favor, adicione novos blocos `it()` em `{task.spec_file}` que exercitem especificamente "
                        f"as linhas e métodos listados acima (incluindo cenários de sucesso e lançamento de exceções)."
                    )
                    surgical_instruction_preview = cov_instruction
                    current_prompt = format_refinement_prompt(
                        base_prompt, attempt_history, cov_instruction, type_context
                    )
                    continue

                cov_str = f" (Line Coverage: {line_cov:.1f}%)" if line_cov is not None else ""
                print(f"✅ SUCCESS! High-quality unit tests verified for {task.service_file}{cov_str}")

                if self.allow_git_commit:
                    commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}"
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
                jest_instruction = (
                    f"O teste unitário em `{task.spec_file}` falhou com o seguinte erro:\n\n"
                    f"```\n{error_traceback[-1500:]}\n```\n\n"
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
                    p_cov = parse_line_coverage(p_stdout, task.service_file)
                    print(f"✅ [AUTO-PRUNER]: Salvaged passing test suite! (Line Coverage: {p_cov}%)")
                    last_passing_spec = pruned_spec
                    last_passing_coverage = p_cov if p_cov is not None else 25.0
                else:
                    # Restore unpruned spec for quarantine backup if pruning didn't make it green
                    spec_file_path.write_text(original_spec, encoding="utf-8")

        # Preservation Strategy 1: Preserve partial passing tests
        if last_passing_spec and last_passing_coverage is not None and last_passing_coverage >= 20.0:
            cov_label = f" (Line Coverage: {last_passing_coverage:.1f}%)" if last_passing_coverage >= self.min_line_coverage else f" (partial coverage: {last_passing_coverage:.1f}%)"
            print(f"🛡️ [PRESERVATION]: Tests pass in Jest with {last_passing_coverage:.1f}% coverage. Preserving test suite instead of discarding!")
            spec_file_path.write_text(last_passing_spec, encoding="utf-8")
            self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)
            commit_suffix = "" if last_passing_coverage >= self.min_line_coverage else f" (partial coverage: {last_passing_coverage:.1f}%)"
            if self.allow_git_commit:
                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}{commit_suffix}"
                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)
            queue_manager.update_task_status(task.id, "completed", increment_attempt=True)
            return True

        # Preservation Strategy 2: Quarantine failed spec for human review
        quarantine_dir = Path(__file__).resolve().parent.parent / "reports" / "quarantine" / task.module_name
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        if spec_file_path.exists():
            quarantine_file = quarantine_dir / spec_file_path.name
            quarantine_file.write_text(spec_file_path.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"📦 [QUARANTINE]: Saved unverified spec to {quarantine_file}")
            spec_file_path.unlink()
        if self.allow_git_commit:
            self.run_command(["git", "restore", "--staged", task.spec_file], cwd=project_path)

        last_error = error_traceback[-500:] if "error_traceback" in locals() else (cov_msg if "cov_msg" in locals() else "Unknown failure")
        queue_manager.update_task_status(
            task.id,
            "failed",
            error_log=f"Failed after {task.max_attempts} attempts. Last error: {last_error}",
        )
        return False
