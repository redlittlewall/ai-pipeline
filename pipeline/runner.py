from datetime import datetime, timezone
from pathlib import Path
import signal
import sys
import time
from typing import List, Optional
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker


class BatchRunner:
    def __init__(
        self,
        queue_manager: QueueManager,
        worker: TaskWorker,
        reports_dir: Optional[Path] = None,
    ):
        self.queue_manager = queue_manager
        self.worker = worker
        base_dir = Path(__file__).parent.parent
        self.reports_dir = reports_dir or (base_dir / "reports")
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.interrupted = False

        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_interrupt)
        signal.signal(signal.SIGTERM, self._handle_interrupt)

    def _handle_interrupt(self, signum, frame):
        print("\n\n⚠️ Execution interrupted by user! Gracefully finishing current task and generating report...")
        self.interrupted = True

    def run_batch(
        self,
        max_tasks: Optional[int] = None,
        module_filter: Optional[List[str]] = None,
    ) -> Path:
        start_time = time.time()
        start_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        processed_tasks: List[dict] = []
        tasks_count = 0

        print("\n🚀 Starting Autonomous AI Testing Pipeline Batch...")
        summary_initial = self.queue_manager.get_summary()
        print(f"Initial Queue State: {summary_initial}")
        if module_filter:
            print(f"Active Module Filter: {module_filter}")

        while not self.interrupted:
            if max_tasks and tasks_count >= max_tasks:
                print(f"Reached limit of {max_tasks} tasks. Stopping batch.")
                break

            task = self.queue_manager.get_next_pending(module_filter=module_filter)
            if not task:
                print("No more pending tasks in queue. All done!")
                break

            tasks_count += 1
            task_start = time.time()

            success = self.worker.execute_task(task, self.queue_manager)
            elapsed = time.time() - task_start

            # Refresh task to get latest status/error
            tasks = self.queue_manager.load_queue()
            latest = next((t for t in tasks if t.id == task.id), task)

            processed_tasks.append({
                "id": latest.id,
                "module": latest.module_name,
                "service": latest.service_file,
                "status": "PASS" if success else "FAIL",
                "attempts": latest.attempts,
                "elapsed": f"{elapsed:.1f}s",
                "error": latest.error_log or "N/A",
            })

        total_elapsed = time.time() - start_time
        global_gate = self._run_global_quality_gate()
        report_path = self._generate_report(processed_tasks, total_elapsed, start_timestamp, global_gate)
        print(f"\n📄 Consolidated execution report generated at: {report_path}")
        return report_path

    def _run_global_quality_gate(self) -> Optional[dict]:
        tasks = self.queue_manager.load_queue()
        if not tasks:
            return None
        project_path = Path(tasks[0].project_path).resolve()
        profile_name = tasks[0].profile
        if not project_path.exists() or profile_name != "nestjs":
            return None

        print("\n=======================================================")
        print("🛡️ [GLOBAL QUALITY GATE]: Verifying full project build & test suite...")
        print("=======================================================")

        build_code, _, build_err = self.worker.run_command(["npm", "run", "build"], cwd=project_path, timeout=120)
        build_ok = build_code == 0
        print(f"  • Global Build (npm run build): {'✅ PASS' if build_ok else '❌ FAIL'}")

        test_code, test_out, test_err = self.worker.run_command(
            ["npx", "jest", "--config", "jest.config.json"], cwd=project_path, timeout=180
        )
        test_ok = test_code == 0
        print(f"  • Global Unit Test Suite (Jest): {'✅ PASS' if test_ok else '❌ FAIL'}")

        summary_line = ""
        for line in (test_out + "\n" + test_err).splitlines():
            if "Test Suites:" in line or "Tests:" in line:
                summary_line += line.strip() + " | "

        return {
            "build_ok": build_ok,
            "test_ok": test_ok,
            "summary": summary_line.strip(" | ") or ("All suites passed" if test_ok else "Check logs"),
        }

    def _generate_report(
        self,
        processed_tasks: List[dict],
        total_elapsed: float,
        start_timestamp: str,
        global_gate: Optional[dict] = None,
    ) -> Path:
        now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        report_file = self.reports_dir / f"run_{now_str}.md"

        success_count = sum(1 for t in processed_tasks if t["status"] == "PASS")
        failure_count = sum(1 for t in processed_tasks if t["status"] == "FAIL")

        content = [
            f"# AI Pipeline Execution Report - {now_str}",
            f"",
            f"- **Execution Start:** {start_timestamp}",
            f"- **Duration:** {total_elapsed:.1f} seconds ({total_elapsed / 60:.1f} minutes)",
            f"- **Model Used:** `{self.worker.model}`",
            f"- **Total Processed:** {len(processed_tasks)}",
            f"- **Successes (PASS):** {success_count}",
            f"- **Failures (FAIL):** {failure_count}",
        ]

        if global_gate:
            content.extend([
                f"- **Global Build (`npm run build`):** {'✅ PASS' if global_gate['build_ok'] else '❌ FAIL'}",
                f"- **Global Test Suite (`npx jest`):** {'✅ PASS' if global_gate['test_ok'] else '❌ FAIL'} ({global_gate['summary']})",
            ])

        content.extend([
            f"",
            f"## Results Summary Table",
            f"",
            f"| Task ID | Module | Service File | Status | Attempts | Elapsed |",
            f"| :--- | :--- | :--- | :---: | :---: | :---: |",
        ])

        for t in processed_tasks:
            icon = "✅ PASS" if t["status"] == "PASS" else "❌ FAIL"
            content.append(f"| `{t['id']}` | `{t['module']}` | `{t['service']}` | {icon} | {t['attempts']} | {t['elapsed']} |")

        if failure_count > 0:
            content.extend([
                f"",
                f"## Failure Details",
                f"",
            ])
            for t in processed_tasks:
                if t["status"] == "FAIL":
                    content.extend([
                        f"### `{t['id']}` - `{t['service']}`",
                        f"**Attempts:** {t['attempts']}",
                        f"```",
                        f"{t['error']}",
                        f"```",
                        f"",
                    ])

        report_file.parent.mkdir(parents=True, exist_ok=True)
        with open(report_file, "w", encoding="utf-8") as f:
            f.write("\n".join(content))

        return report_file
