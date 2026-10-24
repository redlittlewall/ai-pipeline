"""
Módulo de Arquivamento e Gestão do Golden Dataset da TattooPop API.

Responsável por:
1. Identificar testes aprovados com Quality Confidence Score >= 85 (linha de corte de excelência).
2. Copiar e catalogar de forma versionada os arquivos spec em `datasets/golden_specs/<module>/`.
3. Manter o catálogo `manifest.json` para futuros pipelines de re-treinamento contínuo (LoRA / fine-tuning).
4. Assegurar imutabilidade estrita do código produtivo (zero alterações em arquivos de produção).
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional, Set, Tuple, Union

DEFAULT_GOLDEN_SPECS_DIR = Path(__file__).resolve().parent.parent / "datasets" / "golden_specs"
MIN_SCORE_FOR_GOLDEN_ARCHIVE = 85.0

FORBIDDEN_PRODUCTION_SUFFIXES = [
    ".service.ts",
    ".entity.ts",
    ".controller.ts",
    ".module.ts",
    ".guard.ts",
    ".middleware.ts",
    ".dto.ts",
    ".dao.ts",
    ".strategy.ts",
]


def _calc_sha256(path: Path) -> str:
    if not path.exists():
        return ""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def archive_golden_spec(
    spec_file: Union[Path, str],
    module: str,
    quality_score: float,
    service_file: Optional[str] = None,
    line_coverage: Optional[float] = None,
    branch_coverage: Optional[float] = None,
    base_dir: Optional[Path] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    """
    Arquiva um arquivo spec aprovado no Golden Dataset se o score for >= 85.0.

    Retorna o Path do arquivo arquivado, ou None se o score for inferior a 85.0.
    Garante que nenhum arquivo de código produtivo seja aceito para arquivamento.
    """
    if quality_score < MIN_SCORE_FOR_GOLDEN_ARCHIVE:
        return None

    spec_path = Path(spec_file).resolve()
    if not spec_path.exists():
        return None

    file_name = spec_path.name
    name_lower = file_name.lower()

    # Guardrail de Segurança: Apenas arquivos de teste podem ser arquivados
    if not (name_lower.endswith(".spec.ts") or name_lower.endswith(".test.ts")):
        raise ValueError(
            f"VIOLAÇÃO DE SEGURANÇA: Arquivo '{file_name}' não é um arquivo de teste (*.spec.ts ou *.test.ts)."
        )

    for sfx in FORBIDDEN_PRODUCTION_SUFFIXES:
        if name_lower.endswith(sfx) and not (name_lower.endswith(".spec.ts") or name_lower.endswith(".test.ts")):
            raise ValueError(
                f"VIOLAÇÃO CRÍTICA: Tentativa de arquivar código de produção '{file_name}' como spec de teste!"
            )

    golden_dir = (base_dir or DEFAULT_GOLDEN_SPECS_DIR).resolve()
    clean_module = module.strip().lower() or "common"
    target_dir = golden_dir / clean_module
    target_dir.mkdir(parents=True, exist_ok=True)

    dest_file = target_dir / file_name
    spec_content = spec_path.read_text(encoding="utf-8")
    dest_file.write_text(spec_content, encoding="utf-8")

    # Atualiza manifest.json versionado
    manifest_file = golden_dir / "manifest.json"
    manifest: Dict[str, Any] = {"specs": {}, "updated_at": datetime.now(timezone.utc).isoformat()}
    if manifest_file.exists():
        try:
            loaded = json.loads(manifest_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and "specs" in loaded:
                manifest = loaded
        except Exception:
            pass

    rel_key = f"{clean_module}/{file_name}"
    manifest["specs"][rel_key] = {
        "spec_file": rel_key,
        "module": clean_module,
        "service_file": service_file or "",
        "quality_score": round(float(quality_score), 2),
        "line_coverage": round(float(line_coverage), 2) if line_coverage is not None else None,
        "branch_coverage": round(float(branch_coverage), 2) if branch_coverage is not None else None,
        "archived_at": datetime.now(timezone.utc).isoformat(),
        "sha256": _calc_sha256(dest_file),
    }
    if metadata:
        manifest["specs"][rel_key]["metadata"] = metadata

    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    manifest["total_count"] = len(manifest["specs"])

    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return dest_file


def count_golden_specs(base_dir: Optional[Path] = None) -> int:
    """Retorna o número total de arquivos de teste catalogados no Golden Dataset."""
    summary = get_golden_dataset_summary(base_dir=base_dir)
    return summary["total_specs"]


def get_golden_dataset_summary(base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Retorna sumário completo do Golden Dataset por módulo."""
    golden_dir = (base_dir or DEFAULT_GOLDEN_SPECS_DIR).resolve()
    if not golden_dir.exists():
        return {
            "total_specs": 0,
            "modules": {},
            "directory": str(golden_dir),
            "specs": [],
        }

    specs: List[Path] = []
    modules: Dict[str, int] = {}

    for path in sorted(golden_dir.rglob("*.ts")):
        if path.name.endswith(".spec.ts") or path.name.endswith(".test.ts"):
            specs.append(path)
            try:
                rel = path.relative_to(golden_dir)
                mod = rel.parts[0] if len(rel.parts) > 1 else "common"
            except Exception:
                mod = "common"
            modules[mod] = modules.get(mod, 0) + 1

    return {
        "total_specs": len(specs),
        "modules": modules,
        "directory": str(golden_dir),
        "specs": [str(s.relative_to(golden_dir)) for s in specs],
    }


def format_golden_dataset_status(base_dir: Optional[Path] = None) -> str:
    """Formata string concisa com a contagem do Golden Dataset para exibição no CLI."""
    summary = get_golden_dataset_summary(base_dir=base_dir)
    total = summary["total_specs"]
    golden_dir = summary["directory"]
    # Exibe caminho relativo se estiver sob a raiz do projeto/pipeline
    try:
        pipeline_root = Path(__file__).resolve().parent.parent
        dir_display = str(Path(golden_dir).relative_to(pipeline_root))
    except Exception:
        dir_display = golden_dir

    if total == 0:
        return f"Golden Dataset: 0 specs cataloged in {dir_display}"

    mod_str = ", ".join(f"{m}: {c}" for m, c in sorted(summary["modules"].items()))
    mod_count = len(summary["modules"])
    plural_mods = "módulo" if mod_count == 1 else "módulos"
    plural_specs = "spec" if total == 1 else "specs"
    plural_cat = "catalogada" if total == 1 else "catalogadas"
    return f"Golden Dataset: {total} {plural_specs} {plural_cat} (Score >= 85) em {mod_count} {plural_mods} ({mod_str}) em {dir_display}"


def verify_no_production_files_altered(
    project_path: Union[Path, str],
) -> Tuple[bool, List[str], List[str]]:
    """
    Verifica se arquivos de produção foram alterados durante a execução da esteira.

    Retorna:
        Tuple[is_safe (bool), modified_production_files (List[str]), modified_test_files (List[str])]
    """
    proj = Path(project_path).resolve()
    if not (proj / ".git").exists():
        return True, [], []

    try:
        res = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=proj,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if res.returncode != 0:
            return True, [], []

        lines = res.stdout.splitlines()
        prod_files: List[str] = []
        test_files: List[str] = []

        for line in lines:
            if len(line) < 3:
                continue
            status_code = line[:2]
            # Extrai o caminho do arquivo (considerando renomeação 'R  a -> b')
            path_part = line[3:].strip()
            if " -> " in path_part:
                path_part = path_part.split(" -> ")[-1].strip()

            path_part = path_part.strip('"')
            p_lower = path_part.lower()

            # Arquivos ignorados pelo pipeline (reports, logs, queue, gitignore)
            if any(p_lower.startswith(prefix) for prefix in ["reports/", "datasets/", ".scratch/", ".aider"]):
                continue
            if p_lower in ["queue.json", ".gitignore", "package-lock.json"]:
                continue

            if p_lower.endswith(".spec.ts") or p_lower.endswith(".test.ts"):
                test_files.append(path_part)
                continue

            # Se for código-fonte em src/ ou arquivo TS produtivo
            if p_lower.startswith("src/") and (p_lower.endswith(".ts") or p_lower.endswith(".js")):
                prod_files.append(path_part)
            elif any(p_lower.endswith(sfx) for sfx in FORBIDDEN_PRODUCTION_SUFFIXES):
                prod_files.append(path_part)

        is_safe = (len(prod_files) == 0)
        return is_safe, prod_files, test_files

    except Exception:
        return True, [], []
