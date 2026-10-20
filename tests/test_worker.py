from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker, get_file_hash


class TestTaskWorker(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name)
        self.queue_file = self.project_path / "queue.json"
        self.qm = QueueManager(self.queue_file)

        # Create dummy service file
        self.src_dir = self.project_path / "src" / "modules" / "test"
        self.src_dir.mkdir(parents=True, exist_ok=True)
        self.service_file = self.src_dir / "Test.service.ts"
        self.service_file.write_text("export class TestService {}", encoding="utf-8")

        self.spec_file = self.src_dir / "Test.service.spec.ts"

        self.worker = TaskWorker()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_file_hash(self):
        hash1 = get_file_hash(self.service_file)
        self.assertTrue(len(hash1) == 64)

        # Modifying file changes hash
        self.service_file.write_text("modified", encoding="utf-8")
        hash2 = get_file_hash(self.service_file)
        self.assertNotEqual(hash1, hash2)

    @patch.object(TaskWorker, "run_command")
    def test_execute_task_success_first_attempt(self, mock_run_command):
        # Aider succeeds (0), Jest succeeds (0), git commands succeed (0)
        mock_run_command.side_effect = [
            (0, "Aider success", ""),  # Aider execution
            (0, "PASS test", ""),      # Jest execution
            (0, "", ""),               # git add
            (0, "", ""),               # git commit
        ]

        task = Task(
            id="TASK-TEST-001",
            project_path=str(self.project_path),
            service_file="src/modules/test/Test.service.ts",
            spec_file="src/modules/test/Test.service.spec.ts",
            module_name="test",
        )
        self.qm.save_queue([task])

        success = self.worker.execute_task(task, self.qm)
        self.assertTrue(success)

        updated_task = self.qm.load_queue()[0]
        self.assertEqual(updated_task.status, "completed")
        self.assertEqual(updated_task.attempts, 1)


if __name__ == "__main__":
    unittest.main()
