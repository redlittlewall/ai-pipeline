import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from pipeline.quality_score import (
    CoverageMetrics,
    NegativeBranchAnalysis,
    QualityConfidenceScore,
    _format_line_ranges,
    analyze_negative_branches,
    calculate_quality_confidence_score,
    evaluate_quality_gate,
    extract_class_methods,
    find_coverage_entry,
    parse_coverage_final_json,
)
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker


class TestCoverageFinalJsonParser(unittest.TestCase):
    def setUp(self):
        self.sample_coverage_data = {
            "/Users/test/project/src/modules/admin/Admin.service.ts": {
                "path": "/Users/test/project/src/modules/admin/Admin.service.ts",
                "statementMap": {
                    "0": {"start": {"line": 1, "column": 0}, "end": {"line": 1, "column": 30}},
                    "1": {"start": {"line": 5, "column": 2}, "end": {"line": 5, "column": 20}},
                    "2": {"start": {"line": 10, "column": 4}, "end": {"line": 12, "column": 5}},
                    "3": {"start": {"line": 15, "column": 4}, "end": {"line": 15, "column": 35}},
                },
                "branchMap": {
                    "0": {
                        "loc": {"start": {"line": 10, "column": 4}, "end": {"line": 12, "column": 5}},
                        "type": "if",
                        "locations": [
                            {"start": {"line": 10, "column": 4}, "end": {"line": 12, "column": 5}},
                            {"start": {"line": 10, "column": 4}, "end": {"line": 12, "column": 5}},
                        ],
                        "line": 10,
                    }
                },
                "s": {"0": 1, "1": 1, "2": 1, "3": 0},
                "b": {"0": [1, 0]},
                "f": {"0": 1},
            }
        }

    def test_find_coverage_entry_variations(self):
        # 1. Exact absolute path
        entry1 = find_coverage_entry(
            self.sample_coverage_data,
            "/Users/test/project/src/modules/admin/Admin.service.ts",
        )
        self.assertIsNotNone(entry1)

        # 2. Relative path suffix
        entry2 = find_coverage_entry(
            self.sample_coverage_data, "src/modules/admin/Admin.service.ts"
        )
        self.assertIsNotNone(entry2)

        # 3. Filename only
        entry3 = find_coverage_entry(self.sample_coverage_data, "Admin.service.ts")
        self.assertIsNotNone(entry3)

        # 4. Unknown file
        entry4 = find_coverage_entry(self.sample_coverage_data, "Unknown.service.ts")
        self.assertIsNone(entry4)

    def test_parse_coverage_metrics_from_dict(self):
        metrics = parse_coverage_final_json(
            self.sample_coverage_data, "src/modules/admin/Admin.service.ts"
        )
        self.assertIsNotNone(metrics)
        self.assertIsInstance(metrics, CoverageMetrics)

        # Statements: 0 (line 1), 1 (line 5), 2 (lines 10,11,12) executed; 3 (line 15) not executed
        # Unique lines total: {1, 5, 10, 11, 12, 15} = 6 lines
        # Unique lines hit: {1, 5, 10, 11, 12} = 5 lines
        # Line % = 5/6 * 100 = 83.33%
        self.assertAlmostEqual(metrics.line_pct, 83.33, places=2)
        self.assertEqual(metrics.lines_covered, 5)
        self.assertEqual(metrics.lines_total, 6)
        self.assertEqual(metrics.uncovered_lines, [15])

        # Branches: 1 of 2 covered = 50.0%
        self.assertEqual(metrics.branches_covered, 1)
        self.assertEqual(metrics.branches_total, 2)
        self.assertEqual(metrics.branch_pct, 50.0)

        # Statements: 3 of 4 covered = 75.0%
        self.assertEqual(metrics.stmt_pct, 75.0)

    def test_parse_coverage_from_project_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            proj_dir = Path(tmp_dir)
            cov_dir = proj_dir / "coverage"
            cov_dir.mkdir(parents=True, exist_ok=True)
            cov_file = cov_dir / "coverage-final.json"
            cov_file.write_text(json.dumps(self.sample_coverage_data), encoding="utf-8")

            # Load passing project directory
            metrics = parse_coverage_final_json(proj_dir, "Admin.service.ts")
            self.assertIsNotNone(metrics)
            self.assertAlmostEqual(metrics.line_pct, 83.33, places=2)

    def test_format_line_ranges(self):
        self.assertEqual(_format_line_ranges([]), "nenhuma")
        self.assertEqual(_format_line_ranges([5]), "5")
        self.assertEqual(_format_line_ranges([1, 2, 3, 5, 7, 8, 9]), "1-3, 5, 7-9")


class TestNegativeBranchEnforcement(unittest.TestCase):
    def test_extract_class_methods(self):
        service_code = """
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class OrderService {
  constructor(private readonly repo: any) {}

  async findOrder(id: string) {
    if (!id) {
      throw new NotFoundException('ID obrigatório');
    }
    return this.repo.find(id);
  }

  public calculateTotal(price: number, qty: number): number {
    return price * qty;
  }

  private internalHelper() {
    throw new Error('Private');
  }

  protected protectedHelper() {
    throw new Error('Protected');
  }

  safeMethod() {
    // throw new Error('in comment')
    /* throw new Error('in multi comment') */
    return 42;
  }
}
"""
        methods = extract_class_methods(service_code)
        method_names = [name for name, _, _ in methods]

        # Construtor, private e protected não devem constar
        self.assertIn("findOrder", method_names)
        self.assertIn("calculateTotal", method_names)
        self.assertIn("safeMethod", method_names)
        self.assertNotIn("constructor", method_names)
        self.assertNotIn("internalHelper", method_names)
        self.assertNotIn("protectedHelper", method_names)

        # Checagem de lançamento de exceções
        lookup = {name: throws for name, _, throws in methods}
        self.assertTrue(lookup["findOrder"])  # lança NotFoundException
        self.assertFalse(lookup["calculateTotal"])  # não lança
        self.assertFalse(lookup["safeMethod"])  # comentários com throw ignorados

    def test_negative_branches_fully_covered(self):
        service_code = """
export class PhotoService {
  async deletePhoto(id: string) {
    if (!id) {
      throw new NotFoundException('Not found');
    }
  }
}
"""
        spec_code = """
describe('PhotoService', () => {
  describe('deletePhoto', () => {
    it('should throw NotFoundException when photo is missing', async () => {
      await expect(service.deletePhoto(null)).rejects.toThrow(NotFoundException);
    });
  });
});
"""
        analysis = analyze_negative_branches(service_code, spec_code)
        self.assertEqual(analysis.throwing_methods, ["deletePhoto"])
        self.assertEqual(analysis.covered_methods, ["deletePhoto"])
        self.assertEqual(analysis.uncovered_methods, [])
        self.assertTrue(analysis.has_negative_branches)
        self.assertEqual(analysis.score, 30.0)

    def test_negative_branches_missing_rejected(self):
        service_code = """
export class PhotoService {
  async deletePhoto(id: string) {
    if (!id) {
      throw new NotFoundException('Not found');
    }
  }
}
"""
        # Spec que só testa o Happy Path e não tem rejects.toThrow
        spec_code = """
describe('PhotoService', () => {
  it('should delete photo successfully', async () => {
    const result = await service.deletePhoto('123');
    expect(result).toBeDefined();
  });
});
"""
        analysis = analyze_negative_branches(service_code, spec_code)
        self.assertEqual(analysis.throwing_methods, ["deletePhoto"])
        self.assertEqual(analysis.covered_methods, [])
        self.assertEqual(analysis.uncovered_methods, ["deletePhoto"])
        self.assertFalse(analysis.has_negative_branches)
        self.assertEqual(analysis.score, 0.0)

    def test_negative_branches_partially_covered(self):
        service_code = """
export class AccountService {
  async deposit(amount: number) {
    if (amount <= 0) throw new BadRequestException();
  }
  async withdraw(amount: number) {
    if (amount > 1000) throw new BadRequestException();
  }
}
"""
        spec_code = """
describe('AccountService', () => {
  it('should throw on negative deposit', async () => {
    await expect(service.deposit(-10)).rejects.toThrow();
  });
});
"""
        analysis = analyze_negative_branches(service_code, spec_code)
        self.assertEqual(set(analysis.throwing_methods), {"deposit", "withdraw"})
        self.assertEqual(analysis.covered_methods, ["deposit"])
        self.assertEqual(analysis.uncovered_methods, ["withdraw"])
        self.assertFalse(analysis.has_negative_branches)
        # 1 de 2 cobertos: proporcional (1/2 * 30.0 = 15.0 pts)
        self.assertEqual(analysis.score, 15.0)

    def test_service_without_throwing_methods_satisfies_gate(self):
        service_code = """
export class MathUtilsService {
  sum(a: number, b: number) {
    return a + b;
  }
}
"""
        spec_code = """
describe('MathUtilsService', () => {
  it('should sum numbers', () => {
    expect(service.sum(1, 2)).toBe(3);
  });
});
"""
        analysis = analyze_negative_branches(service_code, spec_code)
        self.assertEqual(analysis.throwing_methods, [])
        self.assertTrue(analysis.has_negative_branches)
        self.assertEqual(analysis.score, 30.0)


class TestQualityConfidenceScoreCalculation(unittest.TestCase):
    def test_coverage_tiers(self):
        # < 60%: 0 pts
        s1 = calculate_quality_confidence_score(line_coverage=59.9, attempt=1)
        self.assertEqual(s1.coverage_score, 0.0)

        # 60% a 74.9%: 20 pts
        s2 = calculate_quality_confidence_score(line_coverage=60.0, attempt=1)
        self.assertEqual(s2.coverage_score, 20.0)
        s3 = calculate_quality_confidence_score(line_coverage=74.9, attempt=1)
        self.assertEqual(s3.coverage_score, 20.0)

        # >= 75%: 40 pts
        s4 = calculate_quality_confidence_score(line_coverage=75.0, attempt=1)
        self.assertEqual(s4.coverage_score, 40.0)
        s5 = calculate_quality_confidence_score(line_coverage=95.0, attempt=1)
        self.assertEqual(s5.coverage_score, 40.0)

    def test_attempt_efficiency_tiers(self):
        # 1ª tentativa: 10 pts
        self.assertEqual(calculate_quality_confidence_score(line_coverage=80.0, attempt=1).attempt_efficiency_score, 10.0)
        # 2ª tentativa: 5 pts
        self.assertEqual(calculate_quality_confidence_score(line_coverage=80.0, attempt=2).attempt_efficiency_score, 5.0)
        # 3ª tentativa: 2 pts
        self.assertEqual(calculate_quality_confidence_score(line_coverage=80.0, attempt=3).attempt_efficiency_score, 2.0)
        # 4ª tentativa ou mais: 0 pts
        self.assertEqual(calculate_quality_confidence_score(line_coverage=80.0, attempt=4).attempt_efficiency_score, 0.0)

    def test_anti_sut_mocking_tiers(self):
        # Sem violação: 20 pts
        clean = calculate_quality_confidence_score(line_coverage=80.0, sut_violation=None)
        self.assertEqual(clean.anti_sut_score, 20.0)

        # Com violação de Khorikov: 0 pts
        violated = calculate_quality_confidence_score(line_coverage=80.0, sut_violation="Detectado jest.spyOn(service, ...)")
        self.assertEqual(violated.anti_sut_score, 0.0)
        self.assertFalse(violated.passed)

    def test_perfect_score_100(self):
        # Cobertura 80% (40 pts) + Branches Negativas (30 pts) + Anti-SUT (20 pts) + 1ª Tentativa (10 pts) = 100 pts
        neg = NegativeBranchAnalysis(
            public_methods=["exec"],
            throwing_methods=["exec"],
            covered_methods=["exec"],
            uncovered_methods=[],
            has_negative_branches=True,
            score=30.0,
        )
        score = calculate_quality_confidence_score(
            line_coverage=80.0,
            branch_coverage=85.0,
            negative_analysis=neg,
            sut_violation=None,
            attempt=1,
        )
        self.assertEqual(score.total_score, 100.0)
        self.assertEqual(score.coverage_score, 40.0)
        self.assertEqual(score.negative_branches_score, 30.0)
        self.assertEqual(score.anti_sut_score, 20.0)
        self.assertEqual(score.attempt_efficiency_score, 10.0)
        self.assertTrue(score.passed)

    def test_score_threshold_70_pass_and_fail(self):
        neg_ok = NegativeBranchAnalysis(
            public_methods=["exec"],
            throwing_methods=["exec"],
            covered_methods=["exec"],
            uncovered_methods=[],
            has_negative_branches=True,
            score=30.0,
        )
        neg_fail = NegativeBranchAnalysis(
            public_methods=["exec"],
            throwing_methods=["exec"],
            covered_methods=[],
            uncovered_methods=["exec"],
            has_negative_branches=False,
            score=0.0,
        )

        # PASS: 20 (65% cov) + 30 (neg) + 20 (sut) + 10 (att 1) = 80 pts (>= 70)
        pass_score = calculate_quality_confidence_score(
            line_coverage=65.0,
            negative_analysis=neg_ok,
            attempt=1,
        )
        self.assertEqual(pass_score.total_score, 80.0)
        self.assertTrue(pass_score.passed)

        # FAIL: 20 (65% cov) + 0 (neg fail) + 20 (sut) + 10 (att 1) = 50 pts (< 70)
        fail_score = calculate_quality_confidence_score(
            line_coverage=65.0,
            negative_analysis=neg_fail,
            attempt=1,
        )
        self.assertEqual(fail_score.total_score, 50.0)
        self.assertFalse(fail_score.passed)

        # FAIL por cobertura insuficiente (< 60%): 0 + 30 + 20 + 10 = 60 pts (< 70)
        low_cov_score = calculate_quality_confidence_score(
            line_coverage=55.0,
            negative_analysis=neg_ok,
            attempt=1,
        )
        self.assertEqual(low_cov_score.total_score, 60.0)
        self.assertFalse(low_cov_score.passed)


class TestQuarantineEnforcementWhenScoreBelow70(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name)
        self.queue_file = self.project_path / "queue.json"
        self.qm = QueueManager(self.queue_file)

        self.src_dir = self.project_path / "src" / "modules" / "auth"
        self.src_dir.mkdir(parents=True, exist_ok=True)

        # Serviço com método que lança exceção
        self.service_file = self.src_dir / "Auth.service.ts"
        self.service_file.write_text(
            """
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AuthService {
  async login(password: string) {
    if (password !== 'secret') {
      throw new UnauthorizedException('Senha incorreta');
    }
    return { token: 'jwt' };
  }
}
""",
            encoding="utf-8",
        )

        self.spec_file = self.src_dir / "Auth.service.spec.ts"
        self.worker = TaskWorker(min_line_coverage=60.0)

    def tearDown(self):
        self.temp_dir.cleanup()

    @patch.object(TaskWorker, "run_command")
    def test_worker_rejects_and_quarantines_when_score_below_70_even_if_jest_exits_0(
        self, mock_run_command
    ):
        """
        Valida que suíte com score < 70 (ex: 50% de cobertura de linhas e ausência de
        branches negativas) é rejeitada e enviada para reports/quarantine mesmo se o Jest sair com código 0.
        """
        # Jest sai com código 0, mas tabela mostra apenas 50% de linhas e o spec só testa happy path
        jest_low_output = (
            "PASS src/modules/auth/Auth.service.spec.ts\n"
            "File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s\n"
            "Auth.service.ts | 50.0 | 50.0 | 50.0 | 50.0 | 7-9\n"
        )

        def fake_run_command(cmd, cwd=None, timeout=None):
            cmd_str = " ".join(str(c) for c in cmd)
            if "aider" in cmd_str:
                # Gera teste sem rejects.toThrow para método que lança exceção
                self.spec_file.write_text(
                    "describe('AuthService', () => {\n"
                    "  it('should define service', () => { expect(service).toBeDefined(); });\n"
                    "  it('should login on valid password', async () => {\n"
                    "    const res = await service.login('secret');\n"
                    "    expect(res.token).toBe('jwt');\n"
                    "  });\n"
                    "});",
                    encoding="utf-8",
                )
                return (0, "Aider ran", "")
            elif "prettier" in cmd_str:
                return (0, "", "")
            elif "jest" in cmd_str:
                return (0, jest_low_output, "")
            elif "git" in cmd_str:
                return (0, "", "")
            return (0, "", "")

        mock_run_command.side_effect = fake_run_command

        task = Task(
            id="TASK-QUARANTINE-SCORE-TEST",
            project_path=str(self.project_path),
            service_file="src/modules/auth/Auth.service.ts",
            spec_file="src/modules/auth/Auth.service.spec.ts",
            module_name="auth",
            profile="nestjs",
            max_attempts=2,
        )
        self.qm.save_queue([task])

        # Executa tarefa
        success = self.worker.execute_task(task, self.qm)

        # DEVE FALHAR porque o score < 70
        self.assertFalse(success)

        # Tarefa na fila deve estar como 'failed'
        updated_task = self.qm.load_queue()[0]
        self.assertEqual(updated_task.status, "failed")
        self.assertIn("Quality Confidence Score", updated_task.error_log)
        self.assertIn("reprovado", updated_task.error_log)

        # O arquivo .spec.ts DEVE ter sido removido de src/
        self.assertFalse(self.spec_file.exists())

        # O arquivo DEVE ter sido movido para reports/quarantine/auth/Auth.service.spec.ts
        reports_dir = Path(__file__).resolve().parent.parent / "reports" / "quarantine" / "auth"
        quarantined_file = reports_dir / "Auth.service.spec.ts"
        self.assertTrue(quarantined_file.exists())
        # Limpa arquivo de quarentena gerado pelo teste
        quarantined_file.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
