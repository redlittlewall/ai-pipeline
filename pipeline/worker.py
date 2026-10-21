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
    """Enforces 'let <dep>: any;' for mock dependencies while preserving SUT type."""
    def _repl(m):
        v = m.group(1)
        if v.lower() in ("service", "sut"):
            return m.group(0)
        return f"let {v}: any;"
    return re.sub(
        r'let\s+([a-zA-Z0-9_]+)\s*:\s*(?:Repository<[^>]+>|(?:jest\.)?Mocked<[^;]+>|[A-Z][a-zA-Z0-9_]+);',
        _repl,
        spec_text,
    )


class TaskWorker:
    def __init__(
        self,
        model: str = "ollama/qwen2.5:14b",
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

        # Deterministic Scaffolding (Zero-AI Boilerplate Generation)
        initial_scaffold = None
        if profile.name == "nestjs":
            try:
                from pipeline.scaffolder import NestJSScaffolder
                scaffolder = NestJSScaffolder()
                service_code = service_file_path.read_text(encoding="utf-8")
                initial_scaffold = scaffolder.generate_scaffold(service_file_path, service_code)
                if not spec_file_path.exists() or spec_file_path.stat().st_size < 150:
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
        )

        queue_manager.update_task_status(task.id, "in_progress")
        current_model = self.model
        previous_error: Optional[str] = None
        last_passing_spec: Optional[str] = None
        last_passing_coverage: Optional[float] = None

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
                    f"Lembre-se: NÃO modifique `{task.service_file}` e NUNCA mocke o próprio serviço."
                )

        print(f"🚨 Exhausted all {task.max_attempts} attempts for {task.id}.")

        # Preservation Strategy 1: Preserve partial passing tests
        if last_passing_spec and last_passing_coverage is not None and last_passing_coverage >= 20.0:
            print(f"🛡️ [PRESERVATION]: Tests pass in Jest with {last_passing_coverage:.1f}% coverage. Preserving partial test suite instead of discarding!")
            spec_file_path.write_text(last_passing_spec, encoding="utf-8")
            self.run_command(["npx", "prettier", "--write", task.spec_file], cwd=project_path, timeout=15)
            commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem} (partial coverage: {last_passing_coverage:.1f}%)"
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
