from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from pipeline.dataset_archiver import (
    MIN_SCORE_FOR_GOLDEN_ARCHIVE,
    archive_golden_spec,
    count_golden_specs,
    format_golden_dataset_status,
    get_golden_dataset_summary,
    verify_no_production_files_altered,
)


class TestDatasetArchiver(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.golden_dir = self.base_path / "datasets" / "golden_specs"
        self.golden_dir.mkdir(parents=True, exist_ok=True)

        # Cria spec de teste válida
        self.spec_dir = self.base_path / "src" / "modules" / "tattoo"
        self.spec_dir.mkdir(parents=True, exist_ok=True)
        self.spec_file = self.spec_dir / "AdminAiClassifyTattoo.service.spec.ts"
        self.spec_file.write_text(
            "describe('AdminAiClassifyTattooService', () => { it('works', () => expect(true).toBe(true)); });\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_archive_spec_success_when_score_gte_85(self):
        """Valida que suíte com Quality Score >= 85 é arquivada em datasets/golden_specs/<module>/."""
        archived_path = archive_golden_spec(
            spec_file=self.spec_file,
            module="tattoo",
            quality_score=92.5,
            service_file="src/modules/tattoo/AdminAiClassifyTattoo.service.ts",
            line_coverage=90.0,
            branch_coverage=85.0,
            base_dir=self.golden_dir,
        )

        self.assertIsNotNone(archived_path)
        self.assertTrue(archived_path.exists())
        self.assertEqual(archived_path.parent.name, "tattoo")
        self.assertEqual(archived_path.name, "AdminAiClassifyTattoo.service.spec.ts")

        # Verifica conteúdo e manifest.json
        content = archived_path.read_text(encoding="utf-8")
        self.assertIn("describe('AdminAiClassifyTattooService'", content)

        manifest_file = self.golden_dir / "manifest.json"
        self.assertTrue(manifest_file.exists())
        import json
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        self.assertEqual(manifest["total_count"], 1)
        key = "tattoo/AdminAiClassifyTattoo.service.spec.ts"
        self.assertIn(key, manifest["specs"])
        self.assertEqual(manifest["specs"][key]["quality_score"], 92.5)
        self.assertEqual(manifest["specs"][key]["line_coverage"], 90.0)

    def test_archive_spec_ignored_when_score_lt_85(self):
        """Valida que suíte com score < 85 (ex: 84.9) NÃO é arquivada no Golden Dataset."""
        archived_path = archive_golden_spec(
            spec_file=self.spec_file,
            module="tattoo",
            quality_score=84.9,
            service_file="src/modules/tattoo/AdminAiClassifyTattoo.service.ts",
            base_dir=self.golden_dir,
        )

        self.assertIsNone(archived_path)
        expected_dest = self.golden_dir / "tattoo" / "AdminAiClassifyTattoo.service.spec.ts"
        self.assertFalse(expected_dest.exists())

    def test_archive_spec_rejects_production_code(self):
        """Valida guardrail de segurança: rejeita tentativa de arquivar arquivo de código produtivo."""
        prod_file = self.spec_dir / "AdminAiClassifyTattoo.service.ts"
        prod_file.write_text("export class AdminAiClassifyTattooService {}", encoding="utf-8")

        with self.assertRaises(ValueError) as ctx:
            archive_golden_spec(
                spec_file=prod_file,
                module="tattoo",
                quality_score=95.0,
                base_dir=self.golden_dir,
            )
        self.assertIn("VIOLAÇÃO", str(ctx.exception))

    def test_count_and_summary_golden_specs(self):
        """Valida agregação e contagem de specs por módulo no Golden Dataset."""
        # Inicialmente vazio
        self.assertEqual(count_golden_specs(base_dir=self.golden_dir), 0)

        # Adiciona spec no módulo tattoo
        archive_golden_spec(
            spec_file=self.spec_file,
            module="tattoo",
            quality_score=88.0,
            base_dir=self.golden_dir,
        )

        # Cria e adiciona spec no módulo auth
        auth_spec = self.spec_dir / "AuthLogin.service.spec.ts"
        auth_spec.write_text("describe('AuthLoginService', () => {});\n", encoding="utf-8")
        archive_golden_spec(
            spec_file=auth_spec,
            module="auth",
            quality_score=95.0,
            base_dir=self.golden_dir,
        )

        # Contagem e sumário
        total = count_golden_specs(base_dir=self.golden_dir)
        self.assertEqual(total, 2)

        summary = get_golden_dataset_summary(base_dir=self.golden_dir)
        self.assertEqual(summary["total_specs"], 2)
        self.assertEqual(summary["modules"]["tattoo"], 1)
        self.assertEqual(summary["modules"]["auth"], 1)

    def test_format_golden_dataset_status(self):
        """Valida formatação amigável para saída do comando status."""
        # Vazio
        empty_str = format_golden_dataset_status(base_dir=self.golden_dir)
        self.assertIn("0 specs cataloged", empty_str)

        # Com itens
        archive_golden_spec(
            spec_file=self.spec_file,
            module="tattoo",
            quality_score=89.0,
            base_dir=self.golden_dir,
        )
        status_str = format_golden_dataset_status(base_dir=self.golden_dir)
        self.assertIn("1 spec catalogada (Score >= 85)", status_str)
        self.assertIn("tattoo: 1", status_str)

    @patch("subprocess.run")
    def test_verify_no_production_files_altered_clean(self, mock_subproc):
        """Valida verificação de imutabilidade quando apenas arquivos de teste foram alterados."""
        # Cria .git dummy
        git_dir = self.base_path / ".git"
        git_dir.mkdir(parents=True, exist_ok=True)

        mock_subproc.return_value = MagicMock(
            returncode=0,
            stdout="?? src/modules/tattoo/Test.service.spec.ts\nM  src/modules/auth/Auth.service.spec.ts\n",
        )

        is_safe, prod_files, test_files = verify_no_production_files_altered(self.base_path)
        self.assertTrue(is_safe)
        self.assertEqual(len(prod_files), 0)
        self.assertEqual(len(test_files), 2)

    @patch("subprocess.run")
    def test_verify_no_production_files_altered_detects_violation(self, mock_subproc):
        """Valida que alteração em arquivo de serviço de produção é detectada e sinalizada como violação."""
        git_dir = self.base_path / ".git"
        git_dir.mkdir(parents=True, exist_ok=True)

        mock_subproc.return_value = MagicMock(
            returncode=0,
            stdout="M  src/modules/tattoo/AdminAiClassifyTattoo.service.ts\n?? src/modules/tattoo/AdminAiClassifyTattoo.service.spec.ts\n",
        )

        is_safe, prod_files, test_files = verify_no_production_files_altered(self.base_path)
        self.assertFalse(is_safe)
        self.assertIn("src/modules/tattoo/AdminAiClassifyTattoo.service.ts", prod_files)
        self.assertEqual(len(test_files), 1)


if __name__ == "__main__":
    unittest.main()
