import hashlib
import os
from pathlib import Path
import subprocess
import time
from typing import Optional, Tuple
from pipeline.queue_manager import QueueManager, Task


def get_file_hash(path: Path) -> str:
    if not path.exists():
        return ""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


class TaskWorker:
    def __init__(
        self,
        model: str = "ollama/qwen2.5:14b",
        timeout_seconds: int = 240,
        prompt_template_path: Optional[Path] = None,
    ):
        self.model = model
        self.timeout_seconds = timeout_seconds
        base_dir = Path(__file__).parent.parent
        self.prompt_template_path = prompt_template_path or (base_dir / "templates" / "nestjs_prompt.txt")

    def _load_prompt_template(self) -> str:
        with open(self.prompt_template_path, "r", encoding="utf-8") as f:
            return f.read()

    def _load_golden_template(self, project_path: Path) -> str:
        golden_path = project_path / "src" / "modules" / "configurations" / "Configurations.service.spec.ts"
        if golden_path.exists():
            with open(golden_path, "r", encoding="utf-8") as f:
                return f.read()
        return "// Golden reference template not found."

    def run_command(self, cmd: list, cwd: Path, timeout: Optional[int] = None) -> Tuple[int, str, str]:
        env = os.environ.copy()
        # Set Ollama num_ctx to 8192 for extended context
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

        print(f"\n=======================================================")
        print(f"[{task.id}] Processing: {task.service_file}")
        print(f"Target Spec: {task.spec_file}")
        print(f"Module: {task.module_name}")
        print(f"=======================================================")

        if not service_file_path.exists():
            error_msg = f"Service file not found: {service_file_path}"
            print(f"ERROR: {error_msg}")
            queue_manager.update_task_status(task.id, "failed", error_log=error_msg)
            return False

        # Anti-Cheat: Record initial service hash
        initial_service_hash = get_file_hash(service_file_path)

        # Load templates
        golden_template = self._load_golden_template(project_path)
        prompt_template = self._load_prompt_template()

        current_prompt = prompt_template.format(
            service_file=task.service_file,
            spec_file=task.spec_file,
            golden_template=golden_template,
        )

        queue_manager.update_task_status(task.id, "in_progress")

        for attempt in range(1, task.max_attempts + 1):
            print(f"--- Attempt {attempt}/{task.max_attempts} for {task.id} ---")

            # Dispatch Aider to create/update spec file
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

            # Guardrail: Verify production service file was NOT modified
            current_service_hash = get_file_hash(service_file_path)
            if current_service_hash != initial_service_hash:
                print("⚠️ [ANTI-CHEAT GUARDRAIL TRIGGERED] Production service file was modified! Reverting immediately...")
                self.run_command(["git", "checkout", "--", task.service_file], cwd=project_path)

            # Quality Gate: Run Jest on the target spec file
            print(f"Running Jest verification on: {task.spec_file}...")
            jest_cmd = ["npx", "jest", "--config", "jest.config.json", task.spec_file]
            jest_code, jest_stdout, jest_stderr = self.run_command(jest_cmd, cwd=project_path, timeout=60)

            if jest_code == 0:
                print(f"✅ SUCCESS! All unit tests passed for {task.service_file}")

                # Commit change to git
                commit_msg = f"test({task.module_name}): add unit tests for {Path(task.service_file).stem}"
                self.run_command(["git", "add", task.spec_file], cwd=project_path)
                self.run_command(["git", "commit", "-m", commit_msg], cwd=project_path)

                queue_manager.update_task_status(task.id, "completed", increment_attempt=True)
                return True
            else:
                error_traceback = (jest_stdout + "\n" + jest_stderr).strip()
                print(f"❌ Test verification failed on attempt {attempt}.")
                print(f"Error summary:\n{error_traceback[-500:]}\n")

                queue_manager.update_task_status(
                    task.id,
                    "in_progress",
                    error_log=error_traceback[-1000:],
                    increment_attempt=True,
                )

                # Formulate feedback for next attempt
                current_prompt = (
                    f"O teste unitário em `{task.spec_file}` falhou com o seguinte erro do Jest:\n\n"
                    f"```\n{error_traceback[-1500:]}\n```\n\n"
                    f"Por favor, ajuste EXCLUSIVAMENTE o arquivo `{task.spec_file}` para corrigir os mocks ou asserções e fazer todos os testes passarem. "
                    f"Lembre-se: NÃO modifique `{task.service_file}`."
                )

        # Retries exhausted
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
