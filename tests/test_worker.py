from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker, check_anti_sut_mocking, get_file_hash, parse_line_coverage


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
        self.worker = TaskWorker(min_line_coverage=50.0)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_file_hash(self):
        hash1 = get_file_hash(self.service_file)
        self.assertTrue(len(hash1) == 64)

        self.service_file.write_text("modified", encoding="utf-8")
        hash2 = get_file_hash(self.service_file)
        self.assertNotEqual(hash1, hash2)

    def test_anti_sut_mocking_detection(self):
        bad_spec_1 = "jest.spyOn(service, 'reclassify').mockResolvedValue({});"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_1))

        bad_spec_2 = "jest.spyOn(sut, 'calculate').mockReturnValue(10);"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_2))

        bad_spec_3 = "service.save = jest.fn();"
        self.assertIsNotNone(check_anti_sut_mocking(bad_spec_3))

        good_spec = "expect(repository.findOne).toHaveBeenCalledWith({ id: '1' });"
        self.assertIsNone(check_anti_sut_mocking(good_spec))

    def test_parse_line_coverage(self):
        stdout = (
            "-------------------|---------|----------|---------|---------|-------------------\n"
            "File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s \n"
            "-------------------|---------|----------|---------|---------|-------------------\n"
            " ...too.service.ts |   45.94 |        0 |   33.33 |   84.50 | 31-95             \n"
            "-------------------|---------|----------|---------|---------|-------------------\n"
        )
        cov = parse_line_coverage(stdout, "AdminAiClassifyTattoo.service.ts")
        self.assertEqual(cov, 84.50)

    @patch.object(TaskWorker, "run_command")
    def test_execute_task_success(self, mock_run_command):
        # Create a clean valid spec file
        self.spec_file.write_text("// valid spec", encoding="utf-8")

        coverage_output = (
            "PASS test\n"
            "File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n"
            "Test.service.ts | 80.0 | 50.0 | 80.0 | 75.0 | 10-12\n"
        )

        mock_run_command.side_effect = [
            (0, "Aider success", ""),        # Aider execution
            (0, "Prettier success", ""),     # Prettier formatting
            (0, coverage_output, ""),        # Jest with coverage >= 50%
            (0, "", ""),                     # git add
            (0, "", ""),                     # git commit
        ]

        task = Task(
            id="TASK-TEST-001",
            project_path=str(self.project_path),
            service_file="src/modules/test/Test.service.ts",
            spec_file="src/modules/test/Test.service.spec.ts",
            module_name="test",
            profile="nestjs",
        )
        self.qm.save_queue([task])

        success = self.worker.execute_task(task, self.qm)
        self.assertTrue(success)

        updated_task = self.qm.load_queue()[0]
        self.assertEqual(updated_task.status, "completed")


if __name__ == "__main__":
    unittest.main()
