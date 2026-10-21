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
        try:
            result = subprocess.run(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
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

        for attempt in range(1, task.max_attempts + 1):
            print(f"--- Attempt {attempt}/{task.max_attempts} for {task.id} ---")

            # Self-healing safeguard: if spec file is truncated or corrupt (< 150 bytes), restore clean scaffold
            if initial_scaffold and (not spec_file_path.exists() or spec_file_path.stat().st_size < 150):
                print(f"⚡ [RESTORE] Restoring clean deterministic scaffold before attempt {attempt}...")
                spec_file_path.write_text(initial_scaffold, encoding="utf-8")


            aider_cmd = [
                "aider",
                "--model", self.model,
                "--read", str(service_file_path),
                "--file", str(spec_file_path),
                "--message", current_prompt,
                "--yes",
                "--no-auto-commits",
            ]

            print(f"Calling Aider with model: {self.model}...")
            start_time = time.time()
            ret_code, stdout, stderr = self.run_command(aider_cmd, cwd=project_path)
            duration = time.time() - start_time
            print(f"Aider finished in {duration:.1f}s (Exit code: {ret_code})")

            # Deterministic Mechanical Formatter (Zero-AI)
            if spec_file_path.exists():
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
                if line_cov is not None and line_cov < self.min_line_coverage:
                    cov_msg = (
                        f"COBERTURA INSUFICIENTE: O teste passou no Jest, mas cobriu apenas {line_cov:.1f}% das linhas "
                        f"(mínimo exigido: {self.min_line_coverage}%). Você precisa exercitar a lógica real dos métodos, "
                        f"incluindo os caminhos de sucesso e de tratamento de exceções (sad path)."
                    )
                    print(f"⚠️ [QUALITY GATE REJECTION]: {cov_msg}")
                    current_prompt = f"{cov_msg}\n\nAdicione novos blocos `it(...)` para testar os fluxos restantes do método."
                    queue_manager.update_task_status(
                        task.id, "in_progress", error_log=cov_msg, increment_attempt=True
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

        print(f"🚨 Exhausted all {task.max_attempts} attempts for {task.id}. Discarding failed spec file.")
        if spec_file_path.exists():
            spec_file_path.unlink()
        self.run_command(["git", "restore", "--staged", task.spec_file], cwd=project_path)

        queue_manager.update_task_status(
            task.id,
            "failed",
            error_log=f"Failed after {task.max_attempts} attempts. Last error: {error_traceback[-500:]}",
        )
        return False
