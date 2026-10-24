import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from pipeline.pre_pr_summary import PrePRSummaryGenerator


class TestPrePRSummaryGenerator(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.project_path = self.base_path / "tattoopop-api"
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.reports_dir = self.base_path / "reports"
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.golden_dir = self.base_path / "datasets" / "golden_specs"
        self.golden_dir.mkdir(parents=True, exist_ok=True)

        self.generator = PrePRSummaryGenerator(
            project_path=self.project_path,
            reports_dir=self.reports_dir,
            golden_dataset_dir=self.golden_dir,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    @patch("pipeline.pre_pr_summary.verify_no_production_files_altered")
    def test_generate_summary_approved_flow(self, mock_verify):
        """Valida geração do sumário executivo com veredito de aprovação e métricas completas."""
        mock_verify.return_value = (True, [], ["src/modules/tattoo/Test.service.spec.ts"])

        processed_tasks = [
            {
                "id": "TASK-001",
                "module": "tattoo",
                "service": "src/modules/tattoo/AdminAiClassifyTattoo.service.ts",
                "spec": "src/modules/tattoo/AdminAiClassifyTattoo.service.spec.ts",
                "status": "PASS",
                "attempts": 1,
                "elapsed": "2.5s",
                "quality_score": 95.0,
                "line_coverage": 90.0,
                "branch_coverage": 80.0,
                "archived": True,
            },
            {
                "id": "TASK-002",
                "module": "auth",
                "service": "src/modules/auth/AuthLogin.service.ts",
                "spec": "src/modules/auth/AuthLogin.service.spec.ts",
                "status": "PASS",
                "attempts": 2,
                "elapsed": "4.1s",
                "quality_score": 88.0,
                "line_coverage": 85.0,
                "branch_coverage": 75.0,
                "archived": True,
            },
        ]

        global_gate = {"build_ok": True, "test_ok": True, "summary": "2 suites passed"}

        report_path = self.generator.generate_summary(
            processed_tasks=processed_tasks,
            total_elapsed=6.6,
            global_gate=global_gate,
        )

        self.assertTrue(report_path.exists())
        canonical_path = self.reports_dir / "PRE_PR_SUMMARY.md"
        self.assertTrue(canonical_path.exists())

        content = report_path.read_text(encoding="utf-8")
        self.assertIn("# ⚡ Pre-PR Executive Quality Summary", content)
        self.assertIn("🟢 **APROVADO PARA PR", content)
        self.assertIn("Painel de Decisão Rápida do Tech Lead (< 2 Minutos)", content)
        self.assertIn("AdminAiClassifyTattoo.service.ts", content)
        self.assertIn("AuthLogin.service.ts", content)
        self.assertIn("Imutabilidade do Código de Produção", content)
        self.assertIn("100% ÍNTEGRO", content)
        self.assertIn("Checklist de Aprovação do Tech Lead", content)

    @patch("pipeline.pre_pr_summary.verify_no_production_files_altered")
    def test_generate_summary_blocked_when_production_altered(self, mock_verify):
        """Valida que o sumário BLOQUEIA o PR caso arquivos de produção tenham sido alterados."""
        mock_verify.return_value = (
            False,
            ["src/modules/tattoo/AdminAiClassifyTattoo.service.ts"],
            ["src/modules/tattoo/AdminAiClassifyTattoo.service.spec.ts"],
        )

        processed_tasks = [
            {
                "id": "TASK-001",
                "module": "tattoo",
                "service": "src/modules/tattoo/AdminAiClassifyTattoo.service.ts",
                "spec": "src/modules/tattoo/AdminAiClassifyTattoo.service.spec.ts",
                "status": "PASS",
                "attempts": 1,
                "quality_score": 90.0,
                "line_coverage": 85.0,
                "branch_coverage": 80.0,
                "archived": True,
            }
        ]

        report_path = self.generator.generate_summary(
            processed_tasks=processed_tasks,
            total_elapsed=5.0,
        )

        content = report_path.read_text(encoding="utf-8")
        self.assertIn("🔴 **REPROVADO / BLOQUEADO: Violação de Imutabilidade", content)
        self.assertIn("AdminAiClassifyTattoo.service.ts", content)
        self.assertIn("O PR deve ser bloqueado", content)

    @patch("pipeline.pre_pr_summary.verify_no_production_files_altered")
    def test_generate_summary_warn_on_sonar_blockers(self, mock_verify):
        """Valida que apontamentos Blocker do SonarQube alteram o veredito para REQUER ATENÇÃO."""
        mock_verify.return_value = (True, [], [])

        sonar_file = self.base_path / "sonar_report.json"
        sonar_file.write_text(
            json.dumps({
                "issues": [
                    {
                        "severity": "BLOCKER",
                        "rule": "typescript:S3776",
                        "component": "tattoopop-api:src/modules/tattoo/Test.service.ts",
                        "line": 42,
                        "message": "Cognitive Complexity is too high",
                        "type": "CODE_SMELL",
                    }
                ]
            }),
            encoding="utf-8",
        )

        processed_tasks = [
            {
                "id": "TASK-001",
                "module": "tattoo",
                "service": "src/modules/tattoo/Test.service.ts",
                "spec": "src/modules/tattoo/Test.service.spec.ts",
                "status": "PASS",
                "attempts": 1,
                "quality_score": 85.0,
                "line_coverage": 80.0,
                "branch_coverage": 70.0,
                "archived": True,
            }
        ]

        report_path = self.generator.generate_summary(
            processed_tasks=processed_tasks,
            sonar_json_path=sonar_file,
            total_elapsed=3.0,
        )

        content = report_path.read_text(encoding="utf-8")
        self.assertIn("🟡 **REQUER ATENÇÃO:", content)
        self.assertIn("Blocker no SonarQube", content)
        self.assertIn("Cognitive Complexity is too high", content)

    @patch("pipeline.pre_pr_summary.verify_no_production_files_altered")
    def test_generate_summary_fallback_load_from_queue(self, mock_verify):
        """Valida geração autônoma carregando tarefas de um arquivo queue.json."""
        mock_verify.return_value = (True, [], [])

        queue_file = self.base_path / "queue.json"
        queue_file.write_text(
            json.dumps([
                {
                    "id": "TASK-001",
                    "project_path": str(self.project_path),
                    "service_file": "src/modules/tattoo/Sample.service.ts",
                    "spec_file": "src/modules/tattoo/Sample.service.spec.ts",
                    "module_name": "tattoo",
                    "status": "completed",
                    "attempts": 1,
                }
            ]),
            encoding="utf-8",
        )

        report_path = self.generator.generate_summary(queue_file=queue_file, total_elapsed=2.0)
        content = report_path.read_text(encoding="utf-8")
        self.assertIn("Sample.service.ts", content)
        self.assertIn("tattoo", content)


if __name__ == "__main__":
    unittest.main()
