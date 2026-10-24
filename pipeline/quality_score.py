"""
Motor de Cálculo do Quality Confidence Score (0-100) & Negative Branch Enforcement.

Este módulo implementa o árbitro de meta-qualidade do ai-pipeline:
1. Parser do coverage-final.json do Jest para extração de % de linhas e branches.
2. Analisador estático de asserções negativas (rejects.toThrow / tratamento de erros) para métodos que lançam exceções.
3. Fórmula ponderada do Quality Confidence Score (0 a 100):
   - Cobertura de Linhas (40 pts): < 60% = 0, 60%-74.9% = 20, >= 75% = 40
   - Cenários de Exceção / Branches Negativas (30 pts): presença de rejects.toThrow para métodos que lançam exceções
   - Anti-SUT Mocking (20 pts): 20 se livre de mocks na classe alvo; 0 se violar Khorikov
   - Eficiência de Tentativas (10 pts): 1ª = 10, 2ª = 5, 3ª = 2, >3 = 0
4. Regra de Bloqueio: Suítes com score < 70 são reprovadas e enviadas para quarentena mesmo com exit code 0.
"""

from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union


def _format_line_ranges(lines: List[int]) -> str:
    """Formata lista de números de linha em intervalos legíveis (ex: '10-15, 20, 25-30')."""
    if not lines:
        return "nenhuma"
    sorted_lines = sorted(set(lines))
    ranges = []
    start = prev = sorted_lines[0]
    for num in sorted_lines[1:]:
        if num == prev + 1:
            prev = num
        else:
            ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
            start = prev = num
    ranges.append(f"{start}-{prev}" if start != prev else f"{start}")
    return ", ".join(ranges[:12]) + ("..." if len(ranges) > 12 else "")


@dataclass
class CoverageMetrics:
    line_pct: float
    branch_pct: float
    lines_covered: int
    lines_total: int
    branches_covered: int
    branches_total: int
    uncovered_lines: List[int]
    stmt_pct: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def find_coverage_entry(
    data: Dict[str, Any], service_file: Union[Path, str]
) -> Optional[Dict[str, Any]]:
    """Localiza a entrada correspondente ao arquivo de serviço dentro do JSON de cobertura do Jest."""
    svc_str = str(service_file).replace("\\", "/")
    svc_name = Path(svc_str).name

    # 1. Busca por chave exata
    if svc_str in data:
        return data[svc_str]

    # 2. Busca por caminho resolvido absoluto
    try:
        svc_resolved = str(Path(service_file).resolve()).replace("\\", "/")
        if svc_resolved in data:
            return data[svc_resolved]
    except Exception:
        pass

    # 3. Busca por sufixo de caminho relativo normalizado
    for k, v in data.items():
        k_norm = k.replace("\\", "/")
        if k_norm.endswith(svc_str) or svc_str.endswith(k_norm):
            return v

    # 4. Busca por nome do arquivo (fallback)
    for k, v in data.items():
        if Path(k).name == svc_name:
            return v

    return None


def parse_coverage_final_json(
    cov_source: Union[Path, str, Dict[str, Any]],
    service_file: Union[Path, str],
) -> Optional[CoverageMetrics]:
    """
    Lê e extrai métricas precisas de linhas e branches a partir do coverage-final.json do Jest.
    cov_source pode ser um dicionário já carregado, um caminho para o arquivo coverage-final.json,
    ou o diretório raiz do projeto (onde buscará em coverage/coverage-final.json).
    """
    data: Optional[Dict[str, Any]] = None

    if isinstance(cov_source, dict):
        data = cov_source
    else:
        path = Path(cov_source)
        candidate_paths = [
            path,
            path / "coverage" / "coverage-final.json",
            path / "coverage-final.json",
        ]
        for cp in candidate_paths:
            if cp.is_file():
                try:
                    data = json.loads(cp.read_text(encoding="utf-8"))
                    break
                except Exception:
                    continue

    if not data or not isinstance(data, dict):
        return None

    entry = find_coverage_entry(data, service_file)
    if not entry or not isinstance(entry, dict):
        return None

    stmt_map = entry.get("statementMap", {})
    s_counts = entry.get("s", {})
    branch_map = entry.get("branchMap", {})
    b_counts = entry.get("b", {})

    # Cálculo da Cobertura de Linhas (mapeamento linha a linha a partir dos statements)
    lines_hit: Set[int] = set()
    lines_total: Set[int] = set()

    for stmt_id, count in s_counts.items():
        loc = stmt_map.get(stmt_id, {})
        st_line = loc.get("start", {}).get("line")
        end_line = loc.get("end", {}).get("line", st_line)
        if st_line:
            for ln in range(st_line, (end_line or st_line) + 1):
                lines_total.add(ln)
                if count > 0:
                    lines_hit.add(ln)

    total_stmts = len(s_counts)
    covered_stmts = sum(1 for c in s_counts.values() if c > 0)
    stmt_pct = round((covered_stmts / total_stmts * 100.0), 2) if total_stmts > 0 else 100.0

    if lines_total:
        lines_covered_count = len(lines_hit)
        lines_total_count = len(lines_total)
        line_pct = round((lines_covered_count / lines_total_count) * 100.0, 2)
    else:
        lines_covered_count = covered_stmts
        lines_total_count = total_stmts
        line_pct = stmt_pct

    uncovered_lines = sorted(lines_total - lines_hit)

    # Cálculo da Cobertura de Branches
    total_branches = 0
    covered_branches = 0
    for br_id, counts in b_counts.items():
        for c in counts:
            total_branches += 1
            if c > 0:
                covered_branches += 1

    if total_branches > 0:
        branch_pct = round((covered_branches / total_branches) * 100.0, 2)
    else:
        branch_pct = 100.0

    return CoverageMetrics(
        line_pct=line_pct,
        branch_pct=branch_pct,
        lines_covered=lines_covered_count,
        lines_total=lines_total_count,
        branches_covered=covered_branches,
        branches_total=total_branches,
        uncovered_lines=uncovered_lines,
        stmt_pct=stmt_pct,
    )


# =========================================================================
# Analisador Estático de Branches Negativas (Negative Branch Enforcement)
# =========================================================================

@dataclass
class NegativeBranchAnalysis:
    public_methods: List[str]
    throwing_methods: List[str]
    covered_methods: List[str]
    uncovered_methods: List[str]
    has_negative_branches: bool
    score: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def extract_class_methods(code: str) -> List[Tuple[str, str, bool]]:
    """
    Extrai métodos públicos de classes de serviço TypeScript/NestJS e determina
    se cada método lança exceções explicitamente (throw new / throw).
    Retorna lista de tuplas: (nome_metodo, corpo_metodo, lanca_excecao).
    """
    # 1. Encontra a declaração da classe exportada
    clean_code = re.sub(r"//.*", "", code)
    clean_code = re.sub(r"/\*[\s\S]*?\*/", "", clean_code)

    class_match = re.search(r"export\s+(?:default\s+)?class\s+\w+[^{]*\{", clean_code)
    if not class_match:
        # Fallback: qualquer classe no arquivo
        class_match = re.search(r"class\s+\w+[^{]*\{", clean_code)
        if not class_match:
            return []

    start_idx = class_match.end() - 1  # no '{' da classe
    depth = 0
    class_body = ""
    for i in range(start_idx, len(clean_code)):
        ch = clean_code[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                class_body = clean_code[start_idx + 1 : i]
                break

    if not class_body:
        return []

    # 2. Varre métodos dentro do corpo da classe
    method_pattern = re.compile(
        r"(?:(?P<modifier>public|private|protected)\s+)?"
        r"(?:(?P<static>static)\s+)?"
        r"(?:(?P<async>async)\s+)?"
        r"(?:(?P<getter_setter>get|set)\s+)?"
        r"(?P<name>[a-zA-Z0-9_$]+)\s*\((?P<params>[^)]*)\)\s*"
        r"(?::\s*([^{;]+))?\s*\{"
    )

    methods: List[Tuple[str, str, bool]] = []
    idx = 0
    body_len = len(class_body)

    for m in method_pattern.finditer(class_body):
        name = m.group("name")
        modifier = m.group("modifier")
        getter_setter = m.group("getter_setter")

        # Pula construtor, getters/setters e palavras reservadas
        if name in ("constructor", "if", "for", "while", "switch", "catch"):
            continue
        if getter_setter:
            continue

        # Métodos privados ou protegidos não fazem parte da API pública do serviço
        if modifier in ("private", "protected") or name.startswith("#") or name.startswith("_"):
            continue

        # Encontra o corpo do método com contagem de chaves balanceadas
        m_start = m.end() - 1
        m_depth = 0
        method_body = ""
        for j in range(m_start, body_len):
            c = class_body[j]
            if c == "{":
                m_depth += 1
            elif c == "}":
                m_depth -= 1
                if m_depth == 0:
                    method_body = class_body[m_start + 1 : j]
                    break

        # Verifica se o corpo do método lança exceções explicitamente
        clean_body = re.sub(r"//.*", "", method_body)
        clean_body = re.sub(r"/\*[\s\S]*?\*/", "", clean_body)
        throws_exception = bool(re.search(r"\bthrow\s+", clean_body))

        methods.append((name, method_body, throws_exception))

    return methods


def analyze_negative_branches(service_code: str, spec_code: str) -> NegativeBranchAnalysis:
    """
    Analisa estaticamente se a suíte de teste verifica cenários de exceção / branches negativas
    (rejects.toThrow, toThrow, try/catch com expect) para cada método público que lança exceções no serviço.
    """
    methods = extract_class_methods(service_code)
    public_methods = [name for name, _, _ in methods]
    throwing_methods = [name for name, _, throws in methods if throws]

    # Se nenhum método lança exceções explicitamente, o requisito está satisfeito por padrão
    if not throwing_methods:
        return NegativeBranchAnalysis(
            public_methods=public_methods,
            throwing_methods=[],
            covered_methods=[],
            uncovered_methods=[],
            has_negative_branches=True,
            score=30.0,
        )

    clean_spec = re.sub(r"//.*", "", spec_code)
    clean_spec = re.sub(r"/\*[\s\S]*?\*/", "", clean_spec)

    # Coleta blocos de teste it(...) / test(...) para verificação de escopo
    test_blocks = []
    block_pattern = re.compile(r"\b(?:it|test)\s*\(\s*['\"`](.*?)['\"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{")
    for bm in block_pattern.finditer(clean_spec):
        b_title = bm.group(1)
        b_start = bm.end() - 1
        b_depth = 0
        b_body = ""
        for k in range(b_start, len(clean_spec)):
            if clean_spec[k] == "{":
                b_depth += 1
            elif clean_spec[k] == "}":
                b_depth -= 1
                if b_depth == 0:
                    b_body = clean_spec[b_start + 1 : k]
                    break
        test_blocks.append((b_title, b_body))

    covered_methods: List[str] = []
    uncovered_methods: List[str] = []

    for method_name in throwing_methods:
        is_covered = False
        method_esc = re.escape(method_name)

        # 1. Padrão direto na asserção: expect(...service.method(...)).rejects.toThrow
        direct_reject_pattern = rf"expect\s*\(\s*(?:await\s+)?(?:\w+\.)?{method_esc}\b[\s\S]*?\)\s*\.\s*(?:rejects\s*\.\s*)?toThrow"
        if re.search(direct_reject_pattern, clean_spec):
            is_covered = True

        # 2. Padrão síncrono com callback: expect(() => service.method(...)).toThrow
        sync_throw_pattern = rf"expect\s*\(\s*(?:\(\)\s*=>\s*)?(?:await\s+)?(?:\w+\.)?{method_esc}\b[\s\S]*?\)\s*\.\s*toThrow"
        if not is_covered and re.search(sync_throw_pattern, clean_spec):
            is_covered = True

        # 3. Verificação por bloco de teste it(...)
        if not is_covered:
            for title, body in test_blocks:
                has_method_ref = bool(
                    re.search(rf"\b{method_esc}\b", body) or re.search(rf"\b{method_esc}\b", title)
                )
                if not has_method_ref:
                    continue

                has_negative_assertion = bool(
                    re.search(r"\brejects\s*\.\s*toThrow", body)
                    or re.search(r"\btoThrow\b", body)
                    or (re.search(r"\btry\s*\{", body) and re.search(r"\}\s*catch", body) and "expect(" in body)
                    or (".catch(" in body and "expect(" in body)
                )
                if has_negative_assertion:
                    is_covered = True
                    break

        # 4. Verificação em bloco describe('<method_name>')
        if not is_covered:
            desc_match = re.search(rf"\bdescribe\s*\(\s*['\"`]{method_esc}['\"`]\s*,", clean_spec)
            if desc_match:
                d_start = desc_match.start()
                desc_slice = clean_spec[d_start : d_start + 2500]
                if re.search(r"\brejects\s*\.\s*toThrow", desc_slice) or re.search(r"\btoThrow\b", desc_slice):
                    is_covered = True

        if is_covered:
            covered_methods.append(method_name)
        else:
            uncovered_methods.append(method_name)

    total_throwing = len(throwing_methods)
    covered_count = len(covered_methods)
    has_negative_branches = (len(uncovered_methods) == 0)

    score = 30.0 if has_negative_branches else round((covered_count / total_throwing) * 30.0, 1)

    return NegativeBranchAnalysis(
        public_methods=public_methods,
        throwing_methods=throwing_methods,
        covered_methods=covered_methods,
        uncovered_methods=uncovered_methods,
        has_negative_branches=has_negative_branches,
        score=score,
    )


# =========================================================================
# Motor do Quality Confidence Score (0 a 100)
# =========================================================================

PASS_THRESHOLD: float = 70.0


@dataclass
class QualityConfidenceScore:
    total_score: float
    coverage_score: float
    negative_branches_score: float
    anti_sut_score: float
    attempt_efficiency_score: float
    line_coverage_pct: float
    branch_coverage_pct: float
    passed: bool
    details: Dict[str, Any]

    def summary(self) -> str:
        status_icon = "✅ PASS" if self.passed else "🛑 REPROVADO"
        return (
            f"Quality Confidence Score: {self.total_score:.1f}/100 ({status_icon}) | "
            f"Cobertura: {self.coverage_score:.1f}/40 ({self.line_coverage_pct:.1f}% linhas) | "
            f"Branches Negativas: {self.negative_branches_score:.1f}/30 | "
            f"Anti-SUT: {self.anti_sut_score:.1f}/20 | "
            f"Eficiência: {self.attempt_efficiency_score:.1f}/10"
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def calculate_quality_confidence_score(
    line_coverage: Optional[float],
    branch_coverage: Optional[float] = None,
    negative_analysis: Optional[NegativeBranchAnalysis] = None,
    sut_violation: Optional[str] = None,
    attempt: int = 1,
) -> QualityConfidenceScore:
    """
    Calcula a fórmula ponderada do Quality Confidence Score (0 a 100):
    1. Cobertura de Linhas (40 pts):
       - < 60%: 0 pts (Reprovado)
       - 60% a 74.9%: 20 pts
       - >= 75%: 40 pts
    2. Branches Negativas / Cenários de Exceção (30 pts):
       - 30 pts se todos os métodos que lançam exceções possuírem asserções de erro (ou se nenhum método lançar)
       - Proporcional (cobertos / total * 30.0) se faltar algum método
    3. Anti-SUT Mocking de Khorikov (20 pts):
       - 20 pts se 100% livre de mocks sobre a própria classe alvo
       - 0 pts se violar Khorikov
    4. Eficiência de Tentativas (10 pts):
       - 1ª tentativa: 10 pts
       - 2ª tentativa: 5 pts
       - 3ª tentativa: 2 pts
       - Tentativas > 3: 0 pts

    Score Mínimo para Aprovação: 70 pontos.
    """
    failure_reasons: List[str] = []

    # 1. Cobertura de Linhas (40 pts)
    line_cov_val = line_coverage if line_coverage is not None else 0.0
    branch_cov_val = branch_coverage if branch_coverage is not None else 100.0

    if line_cov_val < 60.0:
        cov_score = 0.0
        failure_reasons.append(
            f"Cobertura de linhas insuficiente: {line_cov_val:.1f}% (mínimo exigido: 60.0% para pontuação)"
        )
    elif line_cov_val < 75.0:
        cov_score = 20.0
    else:
        cov_score = 40.0

    # 2. Branches Negativas (30 pts)
    if negative_analysis is None:
        neg_score = 30.0
        neg_enforced = True
    else:
        neg_score = float(negative_analysis.score)
        neg_enforced = bool(negative_analysis.has_negative_branches)
        if not neg_enforced:
            failure_reasons.append(
                f"Negative Branch Enforcement violado: métodos públicos que lançam exceção sem teste de erro: {negative_analysis.uncovered_methods}"
            )

    # 3. Anti-SUT Mocking (20 pts)
    if sut_violation is not None and len(sut_violation.strip()) > 0:
        sut_score = 0.0
        failure_reasons.append(
            "Violação de Anti-SUT Mocking (Khorikov): o próprio serviço alvo foi mockado."
        )
    else:
        sut_score = 20.0

    # 4. Eficiência de Tentativas (10 pts)
    if attempt == 1:
        eff_score = 10.0
    elif attempt == 2:
        eff_score = 5.0
    elif attempt == 3:
        eff_score = 2.0
    else:
        eff_score = 0.0

    total_score = round(cov_score + neg_score + sut_score + eff_score, 1)
    total_score = max(0.0, min(100.0, total_score))

    # Regra de aprovação: Score >= 70 e conformidade estrita de guardrails
    is_score_ok = total_score >= PASS_THRESHOLD
    if not is_score_ok:
        failure_reasons.append(
            f"Score total {total_score:.1f}/100 é inferior ao mínimo obrigatório de {PASS_THRESHOLD:.1f}"
        )

    passed = bool(is_score_ok and sut_score == 20.0 and neg_enforced)

    details = {
        "pass_threshold": PASS_THRESHOLD,
        "line_coverage": line_cov_val,
        "branch_coverage": branch_cov_val,
        "attempt": attempt,
        "negative_analysis": negative_analysis.to_dict() if negative_analysis else None,
        "sut_violation": sut_violation,
        "failure_reasons": failure_reasons,
    }

    return QualityConfidenceScore(
        total_score=total_score,
        coverage_score=cov_score,
        negative_branches_score=neg_score,
        anti_sut_score=sut_score,
        attempt_efficiency_score=eff_score,
        line_coverage_pct=line_cov_val,
        branch_coverage_pct=branch_cov_val,
        passed=passed,
        details=details,
    )


def evaluate_quality_gate(
    project_path: Union[Path, str],
    service_file: Union[Path, str],
    spec_file: Union[Path, str],
    attempt: int = 1,
    jest_stdout: str = "",
) -> QualityConfidenceScore:
    """
    Função agregadora para avaliação completa do Quality Gate:
    1. Extrai cobertura de coverage-final.json (ou jest_stdout como fallback).
    2. Analisa estaticamente asserções negativas no spec para métodos que lançam exceções no serviço.
    3. Verifica regra Anti-SUT Mocking.
    4. Calcula o Quality Confidence Score (0 a 100) e determina se a suíte está aprovada ou reprovada.
    """
    proj = Path(project_path).resolve()
    svc_path = (proj / service_file).resolve() if not Path(service_file).is_absolute() else Path(service_file)
    spc_path = (proj / spec_file).resolve() if not Path(spec_file).is_absolute() else Path(spec_file)

    service_code = svc_path.read_text(encoding="utf-8") if svc_path.exists() else ""
    spec_code = spc_path.read_text(encoding="utf-8") if spc_path.exists() else ""

    # 1. Cobertura
    cov_metrics = parse_coverage_final_json(proj, service_file)
    line_cov: Optional[float] = None
    branch_cov: Optional[float] = None

    if cov_metrics:
        line_cov = cov_metrics.line_pct
        branch_cov = cov_metrics.branch_pct
    elif jest_stdout:
        # Fallback para parsing da tabela texto do Jest
        clean_name = Path(service_file).name
        stem = Path(service_file).stem
        for line in jest_stdout.splitlines():
            if "|" in line:
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 6:
                    filename_col = parts[0]
                    stripped_col = filename_col.lstrip(".").strip()
                    if (
                        clean_name in filename_col
                        or stem in filename_col
                        or (stripped_col and stripped_col in clean_name)
                    ):
                        try:
                            line_cov = float(parts[4])
                            branch_cov = float(parts[2]) if parts[2].replace(".", "", 1).isdigit() else None
                            break
                        except ValueError:
                            pass

    # 2. Branches Negativas
    neg_analysis = analyze_negative_branches(service_code, spec_code)

    # 3. Anti-SUT Mocking
    from pipeline.worker import check_anti_sut_mocking
    sut_violation = check_anti_sut_mocking(spec_code)

    # 4. Cálculo do Score
    return calculate_quality_confidence_score(
        line_coverage=line_cov,
        branch_coverage=branch_cov,
        negative_analysis=neg_analysis,
        sut_violation=sut_violation,
        attempt=attempt,
    )
