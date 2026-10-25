import math
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

from pipeline.ai_monitor import AIMonitor, CallMetric, RateLimitInfo, FREE_TIER_MODEL_POOL
from pipeline.queue_manager import QueueManager, Task
from pipeline.worker import TaskWorker


class TestAIMonitor(unittest.TestCase):
    def setUp(self):
        # Reset singleton instance between tests
        AIMonitor._instance = None
        self.monitor = AIMonitor()

    def test_estimate_tokens(self):
        """Verifica a estimativa empírica de tokens."""
        self.assertEqual(AIMonitor.estimate_tokens(""), 0)
        self.assertEqual(AIMonitor.estimate_tokens(None), 0)
        text = "const a = 10; const b = 20;"  # 27 chars
        expected = math.ceil(27 / 3.8)
        self.assertEqual(AIMonitor.estimate_tokens(text), expected)

    def test_parse_rate_limit_non_rate_limit(self):
        """Verifica que saídas normais ou outros erros não disparam rate limit."""
        self.assertIsNone(self.monitor.parse_rate_limit("All tests passed", "gemini/gemini-3.8-flash"))
        self.assertIsNone(self.monitor.parse_rate_limit("SyntaxError: Unexpected token", "groq/openai/gpt-oss-120b"))

    def test_parse_rate_limit_daily_gemini_quota(self):
        """Verifica detecção de cota diária do Gemini (RPD) com retryDelay de milhares de segundos."""
        error_output = (
            'litellm.RateLimitError: RateLimitError: GeminiException - {"error": {"code": 429, '
            '"message": "Resource has been exhausted (e.g. check quota).", "status": "RESOURCE_EXHAUSTED", '
            '"details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{'
            '"quotaMetric": "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "quotaValue": "20"}]}, '
            '{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "15398s"}]}}'
        )
        rl_info = self.monitor.parse_rate_limit(error_output, "gemini/gemini-3.8-flash")
        self.assertIsNotNone(rl_info)
        self.assertTrue(rl_info.is_rate_limit)
        self.assertTrue(rl_info.is_daily_limit)
        self.assertEqual(rl_info.retry_delay_seconds, 15398)
        self.assertIn("gemini/gemini-3.8-flash", self.monitor.exhausted_daily_models)
        self.assertIsNotNone(rl_info.suggested_model)
        self.assertNotEqual(rl_info.suggested_model, "gemini/gemini-3.8-flash")

    def test_parse_rate_limit_daily_human_string(self):
        """Verifica detecção de cota diária via string de horas (ex: 'retry in 4h16m')."""
        error_output = (
            "RESOURCE_EXHAUSTED: Exceeded your current quota per day. "
            "Please retry in 4h16m."
        )
        rl_info = self.monitor.parse_rate_limit(error_output, "gemini/gemini-3.5-flash")
        self.assertIsNotNone(rl_info)
        self.assertTrue(rl_info.is_rate_limit)
        self.assertTrue(rl_info.is_daily_limit)
        self.assertEqual(rl_info.retry_delay_seconds, (4 * 3600) + (16 * 60))

    def test_parse_rate_limit_per_minute_tpm(self):
        """Verifica detecção de cota por minuto (TPM/RPM) com backoff curto."""
        error_output = (
            "RateLimitError: Rate limit reached for model `groq/openai/gpt-oss-120b` on tokens per minute (TPM). "
            "Please try again in 32.4s."
        )
        rl_info = self.monitor.parse_rate_limit(error_output, "groq/openai/gpt-oss-120b")
        self.assertIsNotNone(rl_info)
        self.assertTrue(rl_info.is_rate_limit)
        self.assertFalse(rl_info.is_daily_limit)
        # 33 + 3 = 36s
        self.assertEqual(rl_info.retry_delay_seconds, 36)
        self.assertNotIn("groq/openai/gpt-oss-120b", self.monitor.exhausted_daily_models)

    def test_model_pool_rotation(self):
        """Verifica rotação dinâmica da pool gratuita quando múltiplos modelos esgotam cota."""
        self.monitor.exhausted_daily_models["gemini/gemini-3.8-flash"] = time.time()
        next_model = self.monitor.get_next_available_model("gemini/gemini-3.8-flash")
        self.assertEqual(next_model, "gemini/gemini-3.5-flash")

        # Se todos os modelos forem esgotados
        for model in FREE_TIER_MODEL_POOL:
            self.monitor.exhausted_daily_models[model] = time.time()

        fallback = self.monitor.get_next_available_model("groq/openai/gpt-oss-120b")
        self.assertEqual(fallback, "ollama/qwen2.5-coder:14b")

    def test_get_active_model(self):
        """Verifica que modelo ativo só é trocado se o solicitado estiver esgotado."""
        self.assertEqual(
            self.monitor.get_active_model("gemini/gemini-3.8-flash"),
            "gemini/gemini-3.8-flash",
        )
        self.monitor.exhausted_daily_models["gemini/gemini-3.8-flash"] = time.time()
        self.assertNotEqual(
            self.monitor.get_active_model("gemini/gemini-3.8-flash"),
            "gemini/gemini-3.8-flash",
        )

    def test_record_call_and_summary(self):
        """Verifica telemetria de chamadas, tokens e formato de status."""
        self.monitor.record_call(
            model="gemini/gemini-3.8-flash",
            elapsed_seconds=5.2,
            prompt_text="Write a test for UserService",
            response_text="describe('UserService', () => {});",
            status="success",
        )
        self.monitor.record_call(
            model="gemini/gemini-3.8-flash",
            elapsed_seconds=1.1,
            prompt_text="Retry test",
            response_text="429 RateLimitError",
            status="rate_limit",
        )

        summary = self.monitor.get_summary()
        self.assertEqual(summary["total_calls"], 2)
        self.assertEqual(summary["success_calls"], 1)
        self.assertEqual(summary["rate_limits_intercepted"], 1)
        self.assertGreater(summary["total_tokens"], 0)

        status_str = self.monitor.format_status()
        self.assertIn("2 chamadas", status_str)
        self.assertIn("rate-limits prevenidos", status_str)


class TestWorkerRateLimitResilience(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.project_path = self.base_path / "tattoopop-api"
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.queue_file = self.base_path / "queue.json"
        self.qm = QueueManager(self.queue_file)

        # Mock service file
        self.service_dir = self.project_path / "src" / "modules" / "test"
        self.service_dir.mkdir(parents=True, exist_ok=True)
        self.service_file = self.service_dir / "TestService.service.ts"
        self.service_file.write_text("export class TestService {}", encoding="utf-8")

        self.task = Task(
            id="TASK-999",
            service_file="src/modules/test/TestService.service.ts",
            spec_file="src/modules/test/TestService.service.spec.ts",
            module_name="test",
            profile="nestjs",
            project_path=str(self.project_path),
        )
        self.qm.save_queue([self.task])

    def tearDown(self):
        self.temp_dir.cleanup()

    @patch("time.sleep", return_value=None)
    @patch.object(TaskWorker, "run_command")
    def test_rate_limit_does_not_consume_attempts(self, mock_run_cmd, mock_sleep):
        """
        Valida que múltiplos erros 429 de Rate Limit NÃO consomem o contador de tentativas da tarefa.
        A tarefa deve rodar retentativas internas com AIMonitor e passar na primeira tentativa oficial.
        """
        spec_path = self.project_path / "src" / "modules" / "test" / "TestService.service.spec.ts"

        # Simula:
        # Chamada 1 Aider: Rate Limit 429 (sem alterar spec)
        # Chamada 2 Aider: Rate Limit 429 (sem alterar spec)
        # Chamada 3 Aider: Sucesso escrevendo spec
        # Chamada 4 Prettier
        # Chamada 5 Jest: PASS 100% coverage
        # Chamada 6 Git diff
        def side_effect(cmd, cwd=None, timeout=None):
            cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
            if "aider" in cmd_str:
                if side_effect.aider_calls < 2:
                    side_effect.aider_calls += 1
                    return 1, "", "RESOURCE_EXHAUSTED: retryDelay: 60s"
                else:
                    spec_path.write_text(
                        "describe('TestService', () => {\n"
                        "  it('should be defined', () => { expect(true).toBe(true); });\n"
                        "  it('should work', () => { expect(true).toBe(true); });\n"
                        "});\n",
                        encoding="utf-8",
                    )
                    return 0, "Spec updated successfully", ""
            elif "prettier" in cmd_str:
                return 0, "", ""
            elif "jest" in cmd_str:
                return 0, "TestService.service.ts | 100 | 100 | 100 | 100 |", ""
            elif "git" in cmd_str:
                return 0, "", ""
            return 0, "", ""

        side_effect.aider_calls = 0
        mock_run_cmd.side_effect = side_effect

        worker = TaskWorker(
            model="gemini/gemini-3.8-flash",
            timeout_seconds=60,
            log_level="quiet",
            allow_git_commit=False,
            golden_dataset_dir=self.base_path / "golden",
        )

        res = worker.execute_task(self.task, self.qm)

        self.assertTrue(res)
        # Crucial: attempt deve ser 1, pois os 2 rate-limits foram interceptados pelo AIMonitor sem queimar tentativa!
        updated_tasks = [t for t in self.qm.load_queue() if t.id == self.task.id]
        self.assertEqual(len(updated_tasks), 1)
        self.assertEqual(updated_tasks[0].attempts, 1)
        self.assertEqual(updated_tasks[0].status, "completed")
        self.assertGreaterEqual(worker.ai_monitor.rate_limit_events, 2)


if __name__ == "__main__":
    unittest.main()
