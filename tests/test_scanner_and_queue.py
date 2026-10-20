import json
from pathlib import Path
import tempfile
import unittest
from pipeline.queue_manager import QueueManager, Task
from pipeline.scanner import ProjectScanner


class TestQueueManager(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.queue_file = Path(self.temp_dir.name) / "test_queue.json"
        self.qm = QueueManager(self.queue_file)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_save_and_load_queue(self):
        task1 = Task(
            id="TASK-001",
            project_path="/tmp/project",
            service_file="src/service1.ts",
            spec_file="src/service1.spec.ts",
            module_name="test",
        )
        self.qm.save_queue([task1])

        loaded = self.qm.load_queue()
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0].id, "TASK-001")
        self.assertEqual(loaded[0].status, "pending")

    def test_add_tasks_prevents_duplicates(self):
        task1 = Task(
            id="TASK-001",
            project_path="/tmp/project",
            service_file="src/service1.ts",
            spec_file="src/service1.spec.ts",
            module_name="test",
        )
        task2 = Task(
            id="TASK-002",
            project_path="/tmp/project",
            service_file="src/service1.ts",  # Duplicate service file
            spec_file="src/service1.spec.ts",
            module_name="test",
        )

        added = self.qm.add_tasks([task1, task2])
        self.assertEqual(added, 1)

    def test_update_task_status(self):
        task = Task(
            id="TASK-001",
            project_path="/tmp/project",
            service_file="src/service1.ts",
            spec_file="src/service1.spec.ts",
            module_name="test",
        )
        self.qm.save_queue([task])

        updated = self.qm.update_task_status("TASK-001", "completed", increment_attempt=True)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, "completed")
        self.assertEqual(updated.attempts, 1)


if __name__ == "__main__":
    unittest.main()
