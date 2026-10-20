from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock
from pipeline.queue_manager import QueueManager, Task
from pipeline.runner import BatchRunner
from pipeline.worker import TaskWorker


class TestBatchRunner(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.queue_file = self.base_path / "queue.json"
        self.reports_dir = self.base_path / "reports"
        self.qm = QueueManager(self.queue_file)

        self.mock_worker = MagicMock(spec=TaskWorker)
        self.mock_worker.model = "test-model"
        self.runner = BatchRunner(self.qm, self.mock_worker, reports_dir=self.reports_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_run_batch_with_tasks(self):
        task1 = Task(
            id="TASK-001",
            project_path=str(self.base_path),
            service_file="src/s1.ts",
            spec_file="src/s1.spec.ts",
            module_name="test",
        )
        task2 = Task(
            id="TASK-002",
            project_path=str(self.base_path),
            service_file="src/s2.ts",
            spec_file="src/s2.spec.ts",
            module_name="test",
        )
        self.qm.save_queue([task1, task2])

        # Worker succeeds for task1, fails for task2
        def execute_side_effect(task, qm):
            if task.id == "TASK-001":
                qm.update_task_status(task.id, "completed")
                return True
            else:
                qm.update_task_status(task.id, "failed", error_log="Mock failure")
                return False

        self.mock_worker.execute_task.side_effect = execute_side_effect

        report_path = self.runner.run_batch(max_tasks=2)
        self.assertTrue(report_path.exists())

        report_content = report_path.read_text(encoding="utf-8")
        self.assertIn("**Total Processed:** 2", report_content)
        self.assertIn("**Successes (PASS):** 1", report_content)
        self.assertIn("**Failures (FAIL):** 1", report_content)
        self.assertIn("Mock failure", report_content)


if __name__ == "__main__":
    unittest.main()
