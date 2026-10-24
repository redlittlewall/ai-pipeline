import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from pipeline.benchmark import (
    BenchmarkHarness,
    ModelBenchmarkResult,
    TaskBenchmarkResult,
    normalize_model_name,
    slugify_model,
)
from pipeline.golden_set import GOLDEN_SET
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker


class TestBenchmarkHarness(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name) / "tattoopop-api"
        self.project_path.mkdir(parents=True, exist_ok=True)

        # Create package.json and nestjs structure so profile detects nestjs
        (self.project_path / "package.json").write_text(
            json.dumps({"dependencies": {"@nestjs/core": "^10.0.0"}}), encoding="utf-8"
        )
        (self.project_path / "src").mkdir(parents=True, exist_ok=True)

        # Create sample service files for each golden set item
        for item in GOLDEN_SET:
            p = self.project_path / item.service_file
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("export class DummyService {}", encoding="utf-8")

        self.reports_dir = Path(self.temp_dir.name) / "reports"
        self.reports_dir.mkdir(parents=True, exist_ok=True)

        # Reference queue.json that must remain unchanged
        self.main_queue_file = Path(self.temp_dir.name) / "queue.json"
        self.main_qm = QueueManager(self.main_queue_file)
        self.original_task = Task(
            id="ORIG-001",
            project_path=str(self.project_path),
            service_file="src/other.service.ts",
            spec_file="src/other.service.spec.ts",
            module_name="other",
        )
        self.main_qm.save_queue([self.original_task])

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_slugify_and_normalize_model(self):
        """Valida a normalização de identificadores de modelos para o Aider e para slugs de arquivos."""
        self.assertEqual(normalize_model_name("gemini-2.5-flash"), "gemini/gemini-2.5-flash")
        self.assertEqual(normalize_model_name("gemini/gemini-2.5-flash"), "gemini/gemini-2.5-flash")
        self.assertEqual(normalize_model_name("groq/openai/gpt-oss-120b"), "groq/openai/gpt-oss-120b")
        self.assertEqual(normalize_model_name("ollama/qwen2.5-coder:14b"), "ollama/qwen2.5-coder:14b")

        self.assertEqual(slugify_model("gemini-2.5-flash"), "gemini-2.5-flash")
        self.assertEqual(slugify_model("groq/openai/gpt-oss-120b"), "groq_openai_gpt-oss-120b")
        self.assertEqual(slugify_model("ollama/qwen2.5-coder:14b"), "ollama_qwen2.5-coder_14b")

    def test_run_benchmark_isolated_queue_and_metrics(self):
        """Valida a execução completa do benchmark em fila isolada sem alterar queue.json principal."""
        models = ["gemini-2.5-flash", "groq/openai/gpt-oss-120b"]

        def mock_worker_factory(model_name: str) -> TaskWorker:
            mock_worker = MagicMock(spec=TaskWorker)
            mock_worker.model = model_name
            mock_worker.allow_git_commit = False

            def fake_execute(task, qm):
                # Simula: primeiros 7 passam na tentativa 1, os outros 3 falham no gpt, mas passam no gemini
                if "gemini" in model_name:
                    qm.update_task_status(task.id, "completed", increment_attempt=True)
                    return True
                else:
                    task_idx = int(task.id.split("-")[-1])
                    if task_idx <= 7:
                        qm.update_task_status(task.id, "completed", increment_attempt=True)
                        return True
                    else:
                        qm.update_task_status(task.id, "failed", error_log="Mock failure", increment_attempt=True)
                        return False

            mock_worker.execute_task.side_effect = fake_execute
            mock_worker.run_command.return_value = (0, "File | % Stmts | % Branch | % Funcs | % Lines\nDummy.service.ts | 80 | 50 | 80 | 75\n", "")
            return mock_worker

        harness = BenchmarkHarness(
            project_path=self.project_path,
            models=models,
            max_attempts=3,
            reports_dir=self.reports_dir,
            worker_factory=mock_worker_factory,
        )

        results = harness.run_benchmark()

        # 1. queue.json principal não foi alterado
        loaded_main = self.main_qm.load_queue()
        self.assertEqual(len(loaded_main), 1)
        self.assertEqual(loaded_main[0].id, "ORIG-001")

        # 2. Resultados de ambos os modelos foram calculados
        self.assertIn("gemini-2.5-flash", results)
        self.assertIn("groq/openai/gpt-oss-120b", results)

        gemini_res = results["gemini-2.5-flash"]
        self.assertEqual(gemini_res.total_tasks, 10)
        self.assertEqual(gemini_res.passed_count, 10)
        self.assertEqual(gemini_res.first_pass_count, 10)
        self.assertEqual(gemini_res.first_pass_rate, 1.0)
        self.assertTrue(gemini_res.build_ok)

        groq_res = results["groq/openai/gpt-oss-120b"]
        self.assertEqual(groq_res.total_tasks, 10)
        self.assertEqual(groq_res.passed_count, 7)
        self.assertEqual(groq_res.failed_count, 3)
        self.assertEqual(groq_res.first_pass_count, 7)
        self.assertEqual(groq_res.first_pass_rate, 0.7)

        # 3. Arquivos JSON brutos foram persistidos
        bench_dir = self.reports_dir / "benchmark"
        json_files = list(bench_dir.glob("benchmark_*.json"))
        self.assertEqual(len(json_files), 2)

        for jf in json_files:
            data = json.loads(jf.read_text(encoding="utf-8"))
            self.assertIn("model", data)
            self.assertIn("first_pass_rate", data)
            self.assertIn("tasks", data)
            self.assertEqual(len(data["tasks"]), 10)
            self.assertIn("complexity", data["tasks"][0])
            self.assertIn("first_pass", data["tasks"][0])
            self.assertIn("jest_ok", data["tasks"][0])
            self.assertIn("build_ok", data["tasks"][0])

        # 4. Relatório consolidado em Markdown foi gerado
        md_reports = list(self.reports_dir.glob("benchmark_golden_set_*.md"))
        self.assertTrue(len(md_reports) >= 1)
        md_text = md_reports[0].read_text(encoding="utf-8")
        self.assertIn("Benchmark de Qualidade no Golden Set", md_text)
        self.assertIn("gemini-2.5-flash", md_text)
        self.assertIn("groq/openai/gpt-oss-120b", md_text)
        self.assertIn("First-Pass Rate", md_text)
        self.assertIn("Baixa Complexidade", md_text)
        self.assertIn("Alta Complexidade TypeORM", md_text)

    def test_spec_restoration_after_benchmark(self):
        """Valida que arquivos de spec pré-existentes são restaurados e arquivos novos são limpos."""
        target_service = GOLDEN_SET[0]
        spec_path = self.project_path / target_service.spec_file
        original_content = "// Pre-existing spec content from user"
        spec_path.parent.mkdir(parents=True, exist_ok=True)
        spec_path.write_text(original_content, encoding="utf-8")

        mock_worker = MagicMock(spec=TaskWorker)
        mock_worker.model = "test-model"
        mock_worker.allow_git_commit = False
        mock_worker.execute_task.return_value = True
        mock_worker.run_command.return_value = (0, "PASS", "")

        harness = BenchmarkHarness(
            project_path=self.project_path,
            models=["test-model"],
            reports_dir=self.reports_dir,
            worker_factory=lambda m: mock_worker,
        )

        harness.run_benchmark()

        # O conteúdo original do arquivo deve ter sido restaurado
        self.assertTrue(spec_path.exists())
        self.assertEqual(spec_path.read_text(encoding="utf-8"), original_content)


if __name__ == "__main__":
    unittest.main()
