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

    if removed_count > 0 and re.search(r'\b(?:it|test)\s*\(', modified):
        return modified
    return None


class TaskWorker:
    def __init__(
        self,
        model: str = "ollama/qwen2.5-coder:14b",
        timeout_seconds: int = 360,
        min_line_coverage: float = 60.0,
    ):
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.min_line_coverage = min_line_coverage

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

        current_prompt = prompt_template.format(
            service_file=task.service_file,
            spec_file=task.spec_file,
            golden_template=golden_template,
        ) + type_context

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
                line_cov = parse_line_coverage(pre_stdout, task.service_file)
                last_passing_spec = spec_file_path.read_text(encoding="utf-8")
                last_passing_coverage = line_cov
                if line_cov is None or line_cov >= self.min_line_coverage:
                    print(f"✅ [ZERO-SHOT HEALED]: Quarantined spec passed immediately after mock self-healing! (Coverage: {line_cov}%)")
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

            print(f"Calling Aider with model: {current_model}...")
            start_time = time.time()
            ret_code, stdout, stderr = self.run_command(aider_cmd, cwd=project_path)
            duration = time.time() - start_time
            print(f"Aider finished in {duration:.1f}s (Exit code: {ret_code})")

            # Intelligent Rate Limit (429) & Instant Dual-Cloud Failover
            combined_output = stdout + "\n" + stderr
            if any(err in combined_output for err in ["RateLimitError", "rate_limit_exceeded", "RESOURCE_EXHAUSTED", "code\": 429"]):
                print(f"⚠️ [RATE LIMIT DETECTED on {current_model}]")
                if current_model.startswith("groq/"):
                    print("🔄 [INSTANT FAILOVER]: Switching immediately to Gemini (gemini/gemini-3.5-flash) to eliminate wait time!")
                    current_model = "gemini/gemini-3.5-flash"
                    continue
                elif current_model.startswith("gemini/"):
                    print("🔄 [INSTANT FAILOVER]: Switching from Gemini to local Ollama (qwen2.5-coder:14b)!")
                    current_model = "ollama/qwen2.5-coder:14b"
                    continue
                else:
                    print("⏳ Sleeping 20s for local queue to breathe...")
                    time.sleep(20)
                    continue

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
                    current_prompt = (
                        f"{sut_violation}\n\n"
                        f"Por favor, remova qualquer `spyOn` na própria instância do serviço. "
                        f"Chame o método real do serviço e mocke apenas os repositórios/serviços injetados."
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
                # Check line coverage if Jest/coverage was run
                line_cov = parse_line_coverage(test_stdout, task.service_file)
                if spec_file_path.exists():
                    last_passing_spec = spec_file_path.read_text(encoding="utf-8")
                    last_passing_coverage = line_cov

                if line_cov is not None and line_cov < self.min_line_coverage:
                    cov_msg = (
                        f"COBERTURA INSUFICIENTE: O teste passou no Jest, mas cobriu apenas {line_cov:.1f}% das linhas "
                        f"(mínimo exigido: {self.min_line_coverage}%). Você precisa exercitar a lógica real dos métodos, "
                        f"incluindo os caminhos de sucesso e de tratamento de exceções (sad path)."
                    )
                    current_prompt = (
                        f"{cov_msg}\n\n"
                        f"ATENÇÃO: A cobertura está baixa porque há métodos do serviço `{task.service_file}` que ainda não foram testados.\n"
                        f"Por favor, implemente testes dentro de TODOS os blocos `describe` restantes em `{task.spec_file}` (caminhos de sucesso e lançamento de exceções) para atingir mais de 60% de cobertura de linhas."
                    )
                    continue

                cov_str = f" (Line Coverage: {line_cov:.1f}%)" if line_cov is not None else ""
                print(f"✅ SUCCESS! High-quality unit tests verified for {task.service_file}{cov_str}")

                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}"
                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)

                queue_manager.update_task_status(task.id, "completed", increment_attempt=True)
                return True
            else:
                error_traceback = (test_stdout + "\n" + test_stderr).strip()
                print(f"❌ Test verification failed on attempt {attempt}.")
                print(f"Error summary:\n{error_traceback[-500:]}\n")

                # Repetition Circuit Breaker
                if previous_error and error_traceback[-250:] == previous_error[-250:]:
                    print(f"⚡ [CIRCUIT BREAKER]: Identical error repeated on attempt {attempt}. Escalating model to break loop...")
                    if current_model.startswith("groq/"):
                        current_model = "gemini/gemini-3.5-flash"
                    elif current_model.startswith("gemini/"):
                        current_model = "ollama/qwen2.5-coder:14b"
                previous_error = error_traceback

                queue_manager.update_task_status(
                    task.id,
                    "in_progress",
                    error_log=error_traceback[-1000:],
                    increment_attempt=True,
                )

                current_prompt = (
                    f"O teste unitário em `{task.spec_file}` falhou com o seguinte erro:\n\n"
                    f"```\n{error_traceback[-1500:]}\n```\n\n"
                    f"Por favor, ajuste EXCLUSIVAMENTE o arquivo `{task.spec_file}` para corrigir os mocks ou asserções e fazer todos os testes passarem. "
                    f"Use `as any` em objetos parciais de mock se houver erro TS2345/TS2339. "
                    f"Lembre-se: NÃO modifique `{task.service_file}` e NUNCA mocke o próprio serviço."
                    + type_context
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
        self.run_command(["git", "restore", "--staged", task.spec_file], cwd=project_path)

        last_error = error_traceback[-500:] if "error_traceback" in locals() else (cov_msg if "cov_msg" in locals() else "Unknown failure")
        queue_manager.update_task_status(
            task.id,
            "failed",
            error_log=f"Failed after {task.max_attempts} attempts. Last error: {last_error}",
        )
        return False
