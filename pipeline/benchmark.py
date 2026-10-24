"""
Harness de Benchmark do Golden Set da TattooPop API.
Executa avaliações comparativas entre modelos de IA (Gemini, Groq, Ollama) de forma isolada,
sem poluir o queue.json principal, e persiste resultados brutos em JSON e relatórios em Markdown.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from typing import Any, Callable, Dict, List, Optional

from pipeline.golden_set import GOLDEN_SET, GoldenSetItem, create_golden_tasks
from pipeline.profiles.registry import registry
from pipeline.queue_manager import QueueManager, Task
from pipeline.scaffolder import NestJSScaffolder
from pipeline.worker import TaskWorker, parse_line_coverage


def slugify_model(model: str) -> str:
    """Converte o identificador do modelo em um slug seguro para arquivos e diretórios."""
    return re.sub(r"[^a-zA-Z0-9_\-\.]", "_", model).replace(":", "_").replace("/", "_")


def normalize_model_name(model: str) -> str:
    """Garante prefixo do provedor para modelos comuns (ex: gemini-2.5-flash -> gemini/gemini-2.5-flash)."""
    if model.startswith("gemini-") and not model.startswith("gemini/"):
        return f"gemini/{model}"
    return model


@dataclass
class TaskBenchmarkResult:
    task_id: str
    service_file: str
    spec_file: str
    module_name: str
    complexity: str  # "low", "medium", "high"
    status: str  # "PASS" ou "FAIL"
    first_pass: bool
    attempts: int
    elapsed_seconds: float
    jest_ok: bool
    build_ok: bool
    line_coverage: Optional[float] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ModelBenchmarkResult:
    model: str
    model_slug: str
    timestamp: str
    project_path: str
    total_tasks: int
    passed_count: int
    failed_count: int
    first_pass_count: int
    first_pass_rate: float
    total_elapsed_seconds: float
    avg_elapsed_seconds: float
    build_ok: bool
    tasks: List[TaskBenchmarkResult]

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["tasks"] = [t.to_dict() for t in self.tasks]
        return data


class BenchmarkHarness:
    def __init__(
        self,
        project_path: Path,
        models: List[str],
        max_attempts: int = 3,
        timeout: int = 360,
        log_level: str = "compact",
        reports_dir: Optional[Path] = None,
        worker_factory: Optional[Callable[[str], TaskWorker]] = None,
    ):
        self.project_path = Path(project_path).resolve()
        self.models = models
        self.max_attempts = max_attempts
        self.timeout = timeout
        self.log_level = log_level
        base_dir = Path(__file__).resolve().parent.parent
        self.reports_dir = reports_dir or (base_dir / "reports")
        self.benchmark_dir = self.reports_dir / "benchmark"
        self.benchmark_dir.mkdir(parents=True, exist_ok=True)
        self.worker_factory = worker_factory or self._default_worker_factory

    def _default_worker_factory(self, model: str) -> TaskWorker:
        normalized_model = normalize_model_name(model)
        return TaskWorker(
            model=normalized_model,
            timeout_seconds=self.timeout,
            log_level=self.log_level,
            allow_git_commit=False,
        )

    def run_benchmark(self) -> Dict[str, ModelBenchmarkResult]:
        start_all = time.time()
        start_iso = datetime.now(timezone.utc).isoformat()
        results: Dict[str, ModelBenchmarkResult] = {}

        print("\n=======================================================")
        print("🏁 INICIANDO BENCHMARK NO GOLDEN SET (TATTOOPOP API)")
        print(f"Alvo: {self.project_path}")
        print(f"Modelos ({len(self.models)}): {', '.join(self.models)}")
        print(f"Serviços no Golden Set: {len(GOLDEN_SET)} (3 Baixa, 4 Média, 3 Alta)")
        print(f"Máximo de tentativas por serviço: {self.max_attempts}")
        print("=======================================================\n")

        golden_lookup: Dict[str, GoldenSetItem] = {item.service_file: item for item in GOLDEN_SET}

        for model in self.models:
            model_slug = slugify_model(model)
            print(f"\n🧪 [BENCHMARK] Avaliando modelo: '{model}' (slug: {model_slug})...")
            model_start = time.time()

            # Fila isolada de execução para este modelo (sem poluir queue.json principal)
            isolated_queue_path = self.benchmark_dir / f"queue_{model_slug}.json"
            tasks = create_golden_tasks(str(self.project_path), max_attempts=self.max_attempts)
            qm = QueueManager(isolated_queue_path)
            qm.save_queue(tasks)

            worker = self.worker_factory(model)
            profile = registry.detect_profile(self.project_path) or registry.get_profile_by_name("nestjs")

            task_results: List[TaskBenchmarkResult] = []

            for item in GOLDEN_SET:
                service_file_path = self.project_path / item.service_file
                spec_file_path = self.project_path / item.spec_file

                # 1. Backup do arquivo de teste existente (se houver)
                orig_spec_content: Optional[str] = None
                if spec_file_path.exists():
                    try:
                        orig_spec_content = spec_file_path.read_text(encoding="utf-8")
                    except Exception:
                        orig_spec_content = None

                task = next((t for t in qm.load_queue() if t.service_file == item.service_file), None)
                if not task:
                    task = Task(
                        id=item.id,
                        project_path=str(self.project_path),
                        service_file=item.service_file,
                        spec_file=item.spec_file,
                        module_name=item.module_name,
                        profile="nestjs",
                        status="pending",
                        max_attempts=self.max_attempts,
                    )

                # 2. Inicialização com scaffold determinístico limpo
                try:
                    scaffolder = NestJSScaffolder()
                    service_code = service_file_path.read_text(encoding="utf-8") if service_file_path.exists() else ""
                    scaffold = scaffolder.generate_scaffold(service_file_path, service_code)
                    spec_file_path.parent.mkdir(parents=True, exist_ok=True)
                    spec_file_path.write_text(scaffold, encoding="utf-8")
                except Exception as e:
                    print(f"Aviso ao inicializar scaffold para {item.service_file}: {e}")

                # 3. Execução da tarefa
                t_start = time.time()
                exec_error = None
                try:
                    success = worker.execute_task(task, qm)
                except Exception as e:
                    success = False
                    exec_error = str(e)
                    qm.update_task_status(task.id, "failed", error_log=exec_error)
                t_elapsed = time.time() - t_start

                # 4. Coleta de métricas da tarefa
                latest_tasks = qm.load_queue()
                latest_task = next((t for t in latest_tasks if t.id == task.id), task)
                attempts_used = latest_task.attempts
                first_pass = bool(success and attempts_used <= 1)

                # Verificação explícita do Jest e cobertura
                test_cmd = profile.get_test_command(task.spec_file, service_file=task.service_file)
                j_code, j_out, j_err = worker.run_command(test_cmd, cwd=self.project_path, timeout=60)
                jest_ok = (j_code == 0)
                line_cov = parse_line_coverage(j_out, task.service_file)

                # 5. Preservar spec gerado pelo modelo
                if spec_file_path.exists():
                    spec_dest = self.benchmark_dir / "specs" / model_slug / spec_file_path.name
                    spec_dest.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        spec_dest.write_text(spec_file_path.read_text(encoding="utf-8"), encoding="utf-8")
                    except Exception:
                        pass

                # 6. Restaurar estado original do repositório
                if orig_spec_content is not None:
                    spec_file_path.write_text(orig_spec_content, encoding="utf-8")
                else:
                    if spec_file_path.exists():
                        try:
                            spec_file_path.unlink()
                        except Exception:
                            pass

                # Reverter qualquer alteração não intencional em arquivos de produção
                worker.run_command(["git", "checkout", "--", item.service_file], cwd=self.project_path)

                task_res = TaskBenchmarkResult(
                    task_id=item.id,
                    service_file=item.service_file,
                    spec_file=item.spec_file,
                    module_name=item.module_name,
                    complexity=item.complexity,
                    status="PASS" if success else "FAIL",
                    first_pass=first_pass,
                    attempts=attempts_used,
                    elapsed_seconds=round(t_elapsed, 2),
                    jest_ok=jest_ok,
                    build_ok=jest_ok,  # validado com Jest + verificação global posterior
                    line_coverage=line_cov,
                    error=latest_task.error_log or exec_error,
                )
                task_results.append(task_res)

                fp_icon = "⚡ First-Pass" if first_pass else ("✅ Pass" if success else "❌ Fail")
                print(f"  • [{item.complexity.upper():<6}] {item.service_file:<55} -> {fp_icon} ({t_elapsed:.1f}s, tentativas: {attempts_used})")

            # 7. Verificação de build global do projeto para o modelo
            print(f"\n🔍 Verificando build global do projeto para modelo {model}...")
            b_code, b_out, b_err = worker.run_command(["npm", "run", "build"], cwd=self.project_path, timeout=120)
            model_build_ok = (b_code == 0)
            print(f"  • Global Build (npm run build): {'✅ PASS' if model_build_ok else '❌ FAIL'}")

            # Atualiza build_ok nas tarefas se o build global falhar
            for tr in task_results:
                tr.build_ok = bool(tr.jest_ok and model_build_ok)

            # 8. Cálculo de estatísticas consolidadas do modelo
            passed_count = sum(1 for tr in task_results if tr.status == "PASS")
            failed_count = sum(1 for tr in task_results if tr.status == "FAIL")
            first_pass_count = sum(1 for tr in task_results if tr.first_pass)
            first_pass_rate = round(first_pass_count / len(task_results), 4) if task_results else 0.0
            total_elapsed = round(sum(tr.elapsed_seconds for tr in task_results), 2)
            avg_elapsed = round(total_elapsed / len(task_results), 2) if task_results else 0.0

            model_res = ModelBenchmarkResult(
                model=model,
                model_slug=model_slug,
                timestamp=datetime.now(timezone.utc).isoformat(),
                project_path=str(self.project_path),
                total_tasks=len(task_results),
                passed_count=passed_count,
                failed_count=failed_count,
                first_pass_count=first_pass_count,
                first_pass_rate=first_pass_rate,
                total_elapsed_seconds=total_elapsed,
                avg_elapsed_seconds=avg_elapsed,
                build_ok=model_build_ok,
                tasks=task_results,
            )
            results[model] = model_res

            # 9. Salvar JSON bruto do modelo
            timestamp_file = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            raw_json_path = self.benchmark_dir / f"benchmark_{model_slug}_{timestamp_file}.json"
            with open(raw_json_path, "w", encoding="utf-8") as f:
                json.dump(model_res.to_dict(), f, indent=2, ensure_ascii=False)
            print(f"💾 Resultados brutos salvos em: {raw_json_path}")

        # 10. Gerar relatório comparativo em Markdown
        total_all_elapsed = time.time() - start_all
        md_report_path = self._generate_markdown_report(results, total_all_elapsed, start_iso)
        print(f"\n📊 Relatório consolidado do benchmark gerado em: {md_report_path}")

        return results

    def _generate_markdown_report(
        self,
        results: Dict[str, ModelBenchmarkResult],
        total_duration: float,
        start_iso: str,
    ) -> Path:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        report_file = self.reports_dir / f"benchmark_golden_set_{timestamp_str}.md"
        canonical_file = self.reports_dir / f"benchmark_golden_set_{date_str}.md"

        lines: List[str] = [
            f"# Benchmark de Qualidade no Golden Set — TattooPop API",
            f"",
            f"- **Data da Execução:** {start_iso}",
            f"- **Duração Total:** {total_duration:.1f} segundos ({total_duration / 60:.1f} minutos)",
            f"- **Projeto Alvo:** `{self.project_path}`",
            f"- **Modelos Avaliados ({len(results)}):** {', '.join(f'`{m}`' for m in results.keys())}",
            f"- **Tamanho do Golden Set:** {len(GOLDEN_SET)} serviços (3 Baixa, 4 Média, 3 Alta Complexidade)",
            f"",
            f"---",
            f"",
            f"## 1. Tabela Comparativa Consolidada",
            f"",
            f"| Modelo | First-Pass Rate | Taxa de Sucesso | Tempo Médio/Serviço | Tempo Total | Build (`npm run build`) |",
            f"| :--- | :---: | :---: | :---: | :---: | :---: |",
        ]

        for model_name, res in results.items():
            fp_pct = f"{res.first_pass_rate * 100:.1f}% ({res.first_pass_count}/{res.total_tasks})"
            pass_pct = f"{(res.passed_count / res.total_tasks) * 100:.1f}% ({res.passed_count}/{res.total_tasks})"
            build_icon = "✅ PASS" if res.build_ok else "❌ FAIL"
            lines.append(
                f"| `{model_name}` | **{fp_pct}** | {pass_pct} | {res.avg_elapsed_seconds:.1f}s | {res.total_elapsed_seconds:.1f}s | {build_icon} |"
            )

        lines.extend([
            f"",
            f"---",
            f"",
            f"## 2. Performance por Nível de Complexidade",
            f"",
            f"| Modelo | Baixa Complexidade (3) | Média Complexidade (4) | Alta Complexidade TypeORM (3) |",
            f"| :--- | :---: | :---: | :---: |",
        ])

        for model_name, res in results.items():
            by_comp = {"low": [], "medium": "high", "high": []}
            low_tasks = [t for t in res.tasks if t.complexity == "low"]
            med_tasks = [t for t in res.tasks if t.complexity == "medium"]
            high_tasks = [t for t in res.tasks if t.complexity == "high"]

            low_fp = sum(1 for t in low_tasks if t.first_pass)
            low_pass = sum(1 for t in low_tasks if t.status == "PASS")
            med_fp = sum(1 for t in med_tasks if t.first_pass)
            med_pass = sum(1 for t in med_tasks if t.status == "PASS")
            high_fp = sum(1 for t in high_tasks if t.first_pass)
            high_pass = sum(1 for t in high_tasks if t.status == "PASS")

            low_str = f"{low_pass}/{len(low_tasks)} (FP: {low_fp})"
            med_str = f"{med_pass}/{len(med_tasks)} (FP: {med_fp})"
            high_str = f"{high_pass}/{len(high_tasks)} (FP: {high_fp})"

            lines.append(f"| `{model_name}` | {low_str} | {med_str} | {high_str} |")

        lines.extend([
            f"",
            f"---",
            f"",
            f"## 3. Matriz Detalhada por Serviço do Golden Set",
            f"",
        ])

        # Header da matriz com modelos como colunas
        header_cols = ["ID", "Complexidade", "Serviço"] + [f"`{m}`" for m in results.keys()]
        lines.append("| " + " | ".join(header_cols) + " |")
        lines.append("| " + " | ".join([":---", ":---:", ":---"] + [":---:" for _ in results]) + " |")

        for item in GOLDEN_SET:
            row = [f"`{item.id}`", f"`{item.complexity}`", f"`{item.service_file}`"]
            for model_name, res in results.items():
                t = next((task for task in res.tasks if task.service_file == item.service_file), None)
                if t:
                    if t.first_pass:
                        cell = f"⚡ PASS ({t.elapsed_seconds:.1f}s)"
                    elif t.status == "PASS":
                        cell = f"✅ PASS ({t.attempts} att, {t.elapsed_seconds:.1f}s)"
                    else:
                        cell = f"❌ FAIL ({t.attempts} att)"
                else:
                    cell = "N/A"
                row.append(cell)
            lines.append("| " + " | ".join(row) + " |")

        lines.extend([
            f"",
            f"---",
            f"",
            f"## 4. Arquivos de Resultados Brutos (JSON)",
            f"",
        ])
        for model_name, res in results.items():
            lines.append(f"- **`{model_name}`**: `reports/benchmark/benchmark_{res.model_slug}_{timestamp_str}.json`")

        content = "\n".join(lines) + "\n"
        report_file.write_text(content, encoding="utf-8")
        canonical_file.write_text(content, encoding="utf-8")
        return report_file
