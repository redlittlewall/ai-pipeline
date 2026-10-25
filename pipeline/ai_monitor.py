"""
Módulo de Monitoramento de IA, Gestão de Cotas e Throttling Proativo.

Responsável por:
1. Rastrear consumo de chamadas, tokens estimados e tempo de inferência por modelo.
2. Analisar respostas de Rate Limit (HTTP 429 / RESOURCE_EXHAUSTED) para distinguir:
   - Limite por Minuto (TPM / RPM): Requer espera curta (ex: 20s a 60s) e retentativa da mesma tentativa.
   - Limite Diário (RPD): Requer rotação imediata para outro modelo da pool gratuita.
3. Pool dinâmica de modelos gratuitos (Gemini Flash, Groq LPU, Ollama local).
4. Proteger o contador de tentativas da tarefa (NUNCA queimar uma tentativa de teste por rate limit de infraestrutura).
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import math
from pathlib import Path
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union

# Pool de modelos gratuitos categorizada por capacidade e prioridade
FREE_TIER_MODEL_POOL = [
    # Tier 1: Google Gemini Flash (Cotas diárias independentes por modelo)
    "gemini/gemini-3.8-flash",
    "gemini/gemini-3.5-flash",
    "gemini/gemini-3-flash-preview",
    "gemini/gemini-3.1-flash-lite",
    # Tier 2: Groq LPU (1.000 req/dia, limite de 8.000 TPM)
    "groq/openai/gpt-oss-120b",
    "groq/qwen/qwen3.8-27b",
    "groq/openai/gpt-oss-20b",
    # Tier 3: Ollama Local (Offline, sem limite de cotas)
    "ollama/qwen2.5-coder:14b",
]


@dataclass
class RateLimitInfo:
    is_rate_limit: bool
    is_daily_limit: bool
    retry_delay_seconds: int
    raw_reason: str
    suggested_model: Optional[str] = None


@dataclass
class CallMetric:
    model: str
    timestamp: str
    elapsed_seconds: float
    estimated_input_tokens: int
    estimated_output_tokens: int
    status: str  # "success", "rate_limit", "error"


class AIMonitor:
    _instance: Optional["AIMonitor"] = None

    def __init__(self):
        self.metrics: List[CallMetric] = []
        self.exhausted_daily_models: Dict[str, float] = {}  # model -> timestamp when exhausted
        self.rate_limit_events: int = 0
        self.total_cooldown_seconds: float = 0.0

    @classmethod
    def get_instance(cls) -> "AIMonitor":
        if cls._instance is None:
            cls._instance = AIMonitor()
        return cls._instance

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estima tokens com base em média empírica (~4 caracteres por token para código)."""
        if not text:
            return 0
        return max(1, math.ceil(len(text) / 3.8))

    def parse_rate_limit(self, output: str, current_model: str) -> Optional[RateLimitInfo]:
        """
        Analisa o output de erro da API para determinar o tipo de rate limit
        e o tempo de recuperação exato.
        """
        if not output:
            return None

        is_rl = any(err in output for err in [
            "RateLimitError",
            "rate_limit_exceeded",
            "RESOURCE_EXHAUSTED",
            "code\": 429",
            "Error 429",
            "exceeded your current quota",
        ])
        if not is_rl:
            return None

        # 1. Detecção de cota diária esgotada (Google Gemini RPD: "limit: 20", "per day", "retry in Xh")
        is_daily = False
        retry_delay = 60

        # Verifica retryDelay estruturado em segundos (ex: "retryDelay": "15398s")
        m_delay = re.search(r'["\']retryDelay["\']:\s*["\']?(\d+)s?["\']?', output)
        if m_delay:
            delay_sec = int(m_delay.group(1))
            if delay_sec > 300:  # Mais de 5 minutos significa cota diária/longa
                is_daily = True
                retry_delay = delay_sec

        # Verifica menção explícita de limite diário ou horas de espera
        if any(k in output.lower() for k in ["per day", "requests per day", "daily limit", "generate_content_free_tier_requests"]):
            is_daily = True

        m_hours = re.search(r'retry in\s+(\d+)h(\d+)?m?', output, re.IGNORECASE)
        if m_hours:
            is_daily = True
            hours = int(m_hours.group(1))
            mins = int(m_hours.group(2) or 0)
            retry_delay = (hours * 3600) + (mins * 60)

        # 2. Se não for diário, busca tempo de espera de cota por minuto (Groq / Gemini TPM)
        if not is_daily:
            # Ex: "Please try again in 32.4s" ou "retry after 45s"
            m_sec = re.search(r'(?:try again in|retry after|retry in)\s+(\d+(?:\.\d+)?)\s*s', output, re.IGNORECASE)
            if m_sec:
                retry_delay = math.ceil(float(m_sec.group(1))) + 3  # +3s de margem de segurança
            else:
                # Default de segurança: 60s para Gemini (janela deslizante) ou 20s para Groq
                retry_delay = 60 if "gemini" in current_model else 25

        # Se a cota diária deste modelo esgotou, seleciona próximo modelo livre da pool
        suggested_model = None
        if is_daily:
            self.exhausted_daily_models[current_model] = time.time()
            suggested_model = self.get_next_available_model(current_model)

        return RateLimitInfo(
            is_rate_limit=True,
            is_daily_limit=is_daily,
            retry_delay_seconds=retry_delay,
            raw_reason=output[-300:].strip(),
            suggested_model=suggested_model,
        )

    def get_next_available_model(self, failed_model: str) -> str:
        """Retorna o próximo modelo saudável da pool gratuita."""
        for candidate in FREE_TIER_MODEL_POOL:
            # Pula modelos que atingiram a cota diária
            if candidate in self.exhausted_daily_models:
                continue
            if candidate != failed_model:
                return candidate
        # Se todos os modelos de nuvem esgotaram cota diária, o local é infalível
        return "ollama/qwen2.5-coder:14b"

    def get_active_model(self, requested_model: str) -> str:
        """Se o modelo solicitado estiver com cota diária esgotada, retorna o próximo modelo disponível."""
        if requested_model in self.exhausted_daily_models:
            return self.get_next_available_model(requested_model)
        return requested_model

    def record_call(
        self,
        model: str,
        elapsed_seconds: float,
        prompt_text: str = "",
        response_text: str = "",
        status: str = "success",
    ):
        """Registra métricas da chamada para telemetria de consumo."""
        in_tokens = self.estimate_tokens(prompt_text)
        out_tokens = self.estimate_tokens(response_text)

        self.metrics.append(
            CallMetric(
                model=model,
                timestamp=datetime.now(timezone.utc).isoformat(),
                elapsed_seconds=elapsed_seconds,
                estimated_input_tokens=in_tokens,
                estimated_output_tokens=out_tokens,
                status=status,
            )
        )
        if status == "rate_limit":
            self.rate_limit_events += 1

    def sleep_with_progress(self, seconds: int, reason: str = ""):
        """Pausa a execução exibindo contagem regressiva legível no terminal."""
        self.total_cooldown_seconds += seconds
        print(f"\n⏳ [AI MONITOR / BACKOFF]: {reason}")
        print(f"   ↳ Pausando esteira por {seconds}s para restabelecimento de cota...")

        step = 5 if seconds > 10 else 1
        remaining = seconds
        while remaining > 0:
            time.sleep(min(step, remaining))
            remaining -= min(step, remaining)
            if remaining > 0 and remaining % 10 == 0:
                print(f"   ↳ Restam {remaining}s para retomada...")

        print("   ✅ Janela reaberta! Retomando execução sem queimar tentativa da tarefa.\n")

    def get_summary(self) -> Dict[str, Any]:
        """Retorna sumário consolidado de consumo e telemetria da IA."""
        total_calls = len(self.metrics)
        success_calls = sum(1 for m in self.metrics if m.status == "success")
        rate_limits = sum(1 for m in self.metrics if m.status == "rate_limit")
        total_in_tokens = sum(m.estimated_input_tokens for m in self.metrics)
        total_out_tokens = sum(m.estimated_output_tokens for m in self.metrics)
        total_time = sum(m.elapsed_seconds for m in self.metrics)

        model_counts: Dict[str, int] = {}
        for m in self.metrics:
            model_counts[m.model] = model_counts.get(m.model, 0) + 1

        return {
            "total_calls": total_calls,
            "success_calls": success_calls,
            "rate_limits_intercepted": rate_limits,
            "total_tokens": total_in_tokens + total_out_tokens,
            "input_tokens": total_in_tokens,
            "output_tokens": total_out_tokens,
            "total_inference_time_seconds": round(total_time, 1),
            "total_cooldown_seconds": round(self.total_cooldown_seconds, 1),
            "models_used": model_counts,
            "exhausted_daily_models": list(self.exhausted_daily_models.keys()),
        }

    def format_status(self) -> str:
        """Formata resumo conciso para CLI `status`."""
        s = self.get_summary()
        if s["total_calls"] == 0:
            return "AI Monitor: Nenhuma chamada registrada na sessão atual."
        return (
            f"AI Monitor: {s['total_calls']} chamadas | "
            f"~{s['total_tokens']:,} tokens processados | "
            f"{s['rate_limits_intercepted']} rate-limits prevenidos | "
            f"Modelos ativos: {', '.join(s['models_used'].keys())}"
        )
