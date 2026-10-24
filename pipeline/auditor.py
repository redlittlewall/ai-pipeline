from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
from typing import Any, Dict, List, Optional


@dataclass
class AuditFinding:
    severity: str  # "HIGH", "MEDIUM", "LOW"
    category: str
    file: str
    line: int
    message: str
    suggestion: str


def _format_line_ranges(lines: List[int]) -> str:
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


class StaticQualityAuditor:
    """
    Audits NestJS/TypeScript services and specs combining:
    1. Static & Architectural Heuristics (DI wiring, Dead Code, Shallow Specs, SQLi)
    2. Jest Coverage JSON Reader (coverage/coverage-final.json -> exact uncovered lines, branches & methods)
    3. ESLint / TypeScript-ESLint / SonarJS JSON Reader (AST-level floating promises, complexity, code smells)
    4. SonarQube Issues JSON Importer (external SonarQube report -> pipeline findings/tasks)
    """

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path).resolve()
        self.src_root = self.project_path / "src"
        self.module_files_content: str = self._load_all_modules_content()

    def _load_all_modules_content(self) -> str:
        if not self.src_root.exists():
            return ""
        chunks = []
        for m_file in self.src_root.rglob("*.ts"):
            if m_file.name.endswith(".spec.ts") or m_file.name.endswith(".test.ts"):
                continue
            if any(k in m_file.name.lower() for k in ["module.ts", "provider", "index.ts"]):
                try:
                    chunks.append(m_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
        return "\n".join(chunks)

    def audit_files(
        self,
        module_filter: Optional[List[str]] = None,
        limit: Optional[int] = None,
        run_eslint: bool = False,
        run_coverage: bool = False,
        sonar_json_path: Optional[Path] = None,
    ) -> List[AuditFinding]:
        findings: List[AuditFinding] = []
        if not self.src_root.exists():
            return findings

        candidates: List[Path] = []
        for f in sorted(self.src_root.rglob("*.ts")):
            if f.name.endswith(".spec.ts") or f.name.endswith(".test.ts"):
                continue
            if not any(
                k in f.name.lower()
                for k in ["service.ts", "workflow.ts", "controller.ts", "guard.ts"]
            ):
                continue
            rel_str = str(f.relative_to(self.project_path)).lower()
            if module_filter and not any(m.lower() in rel_str for m in module_filter):
                continue
            candidates.append(f)

        if limit:
            candidates = candidates[:limit]

        for file_path in candidates:
            findings.extend(self.audit_single_file(file_path))

        if run_eslint and candidates:
            findings.extend(self.run_eslint_json_audit(candidates))

        if run_coverage and candidates:
            findings.extend(self.run_jest_coverage_json_audit(candidates))

        if sonar_json_path:
            findings.extend(self.load_sonarqube_json(sonar_json_path, module_filter=module_filter))

        return findings

    def audit_single_file(self, file_path: Path) -> List[AuditFinding]:
        findings: List[AuditFinding] = []
        rel_path = str(file_path.relative_to(self.project_path))
        try:
            code = file_path.read_text(encoding="utf-8")
        except Exception:
            return findings

        lines = code.splitlines()

        # 1. Check if completely commented out / dead file
        uncommented = re.sub(r"/\*[\s\S]*?\*/", "", code)
        active_lines = [l for l in uncommented.splitlines() if l.strip() and not l.strip().startswith("//")]
        if "export class" not in "\n".join(active_lines):
            findings.append(
                AuditFinding(
                    severity="LOW",
                    category="DEAD_CODE",
                    file=rel_path,
                    line=1,
                    message="Arquivo sem classe exportada ativa (100% comentado ou código morto).",
                    suggestion="Remover o arquivo do repositório se não for mais utilizado.",
                )
            )
            return findings

        # 2. Check NestJS Module registration (DI Wiring)
        class_match = re.search(r"export\s+class\s+([A-Za-z0-9_]+)", "\n".join(active_lines))
        if class_match and self.module_files_content:
            class_name = class_match.group(1)
            if class_name not in self.module_files_content and class_name != "AppController":
                findings.append(
                    AuditFinding(
                        severity="MEDIUM",
                        category="DI_ORPHAN_PROVIDER",
                        file=rel_path,
                        line=1,
                        message=f"A classe '{class_name}' não foi encontrada registrada em nenhum '*Module.ts'.",
                        suggestion=f"Verificar se '{class_name}' é código órfão ou se faltou declará-la em providers/controllers do módulo.",
                    )
                )

        # 3. Detect async methods on dependencies for Floating Promise check
        sync_collections = set(
            re.findall(r"(?:readonly\s+)?([a-zA-Z0-9_]+)\s*=\s*new\s+(?:Map|Set)\b", code)
        )
        async_call_pattern = re.compile(
            r"^\s*this\.([a-zA-Z0-9_]+)\.(?:save|update|delete|softDelete|interact|call|send\w+|create\w+|sync\w+)\s*\("
        )
        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue

            m_async = async_call_pattern.match(line)
            if m_async and m_async.group(1) not in sync_collections:
                prev_line = lines[idx - 2].strip() if idx >= 2 else ""
                window_before = "\n".join(lines[max(0, idx - 3) : idx])
                window_after = "\n".join(lines[idx - 1 : min(len(lines), idx + 4)])
                is_arrow_return = prev_line.endswith("=>") or "Promise.all" in window_before
                if (
                    not is_arrow_return
                    and not any(k in line for k in ["await ", "return ", "const ", "let ", "var ", "=>"])
                    and ".catch(" not in window_after
                ):
                    findings.append(
                        AuditFinding(
                            severity="HIGH",
                            category="FLOATING_PROMISE",
                            file=rel_path,
                            line=idx,
                            message=f"Chamada assíncrona potencialmente sem 'await' ou '.catch()': `{stripped[:70]}`",
                            suggestion="Adicionar `await` ou `.catch((e) => this.logger.error(...))` para evitar UnhandledPromiseRejection.",
                        )
                    )

            # 4. Check SQL Injection risk via template literal interpolation in .where() or .query()
            if re.search(r"\.(?:query|where|andWhere|orWhere)\s*\(\s*`[^`]*\$\{", line):
                findings.append(
                    AuditFinding(
                        severity="HIGH",
                        category="SQL_INJECTION_RISK",
                        file=rel_path,
                        line=idx,
                        message=f"Interpolação direta de string `${{...}}` em query TypeORM: `{stripped[:70]}`",
                        suggestion="Usar parâmetros nomeados do TypeORM (ex: `.where('col = :val', { val })`) em vez de template strings.",
                    )
                )

        # 5. Check Monolithic Complexity (> 250 lines)
        if len(lines) > 250:
            findings.append(
                AuditFinding(
                    severity="MEDIUM",
                    category="HIGH_COMPLEXITY",
                    file=rel_path,
                    line=1,
                    message=f"Arquivo extenso com {len(lines)} linhas (alta complexidade cognitiva).",
                    suggestion="Considerar extrair sub-rotinas privadas e usar Method Slicing para ampliar cobertura de testes.",
                )
            )

        # 6. Audit paired .spec.ts quality if it exists
        spec_path = file_path.with_name(file_path.stem + ".spec.ts")
        if spec_path.exists():
            try:
                spec_code = spec_path.read_text(encoding="utf-8")
                rel_spec = str(spec_path.relative_to(self.project_path))
                it_count = len(re.findall(r"\b(?:it|test)\s*\(", spec_code))
                expect_count = len(re.findall(r"\bexpect\s*\(", spec_code))
                todo_count = len(re.findall(r"//\s*TODO:", spec_code))

                if todo_count > 0:
                    findings.append(
                        AuditFinding(
                            severity="MEDIUM",
                            category="INCOMPLETE_SPEC_TODOS",
                            file=rel_spec,
                            line=1,
                            message=f"O teste possui {todo_count} bloco(s) `// TODO` ainda não implementados.",
                            suggestion="Executar expansão incremental nos métodos pendentes deste spec.",
                        )
                    )
                if it_count <= 1 and expect_count <= 1:
                    findings.append(
                        AuditFinding(
                            severity="HIGH",
                            category="SHALLOW_TEST_SUITE",
                            file=rel_spec,
                            line=1,
                            message=f"Suíte de teste superficial (apenas {it_count} teste e {expect_count} expect).",
                            suggestion="Adicionar cenários Given-When-Then de sucesso e erro para os métodos públicos.",
                        )
                    )
            except Exception:
                pass

        return findings

    # =========================================================================
    # EXTERNAL READER 1: ESLint / TypeScript-ESLint / SonarJS JSON AST Reader
    # =========================================================================
    def run_eslint_json_audit(self, target_files: List[Path]) -> List[AuditFinding]:
        """Runs ESLint with TypeScript AST rules (floating promises, complexity) and parses its JSON output."""
        findings: List[AuditFinding] = []
        rel_files = [str(f.relative_to(self.project_path)) for f in target_files]
        if not rel_files:
            return findings

        cmd = [
            "npx",
            "eslint",
            "--format",
            "json",
            "--rule",
            "@typescript-eslint/no-floating-promises: error",
            "--rule",
            "@typescript-eslint/no-misused-promises: error",
            "--rule",
            "complexity: [warn, 10]",
            *rel_files,
        ]
        try:
            res = subprocess.run(
                cmd,
                cwd=str(self.project_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=90,
            )
            raw_out = res.stdout.strip()
            if not raw_out.startswith("["):
                bracket_idx = raw_out.find("[")
                if bracket_idx != -1:
                    raw_out = raw_out[bracket_idx:]
            report = json.loads(raw_out) if raw_out.startswith("[") else []
        except Exception:
            return findings

        for file_entry in report:
            f_path = file_entry.get("filePath", "")
            try:
                rel_path = str(Path(f_path).resolve().relative_to(self.project_path))
            except Exception:
                rel_path = f_path

            for msg in file_entry.get("messages", []):
                rule_id = msg.get("ruleId") or "eslint-general"
                # Filter out noisy formatting/prettier or unused-vars warnings unless critical
                if rule_id in ("prettier/prettier", "@typescript-eslint/no-unused-vars", "@typescript-eslint/no-require-imports"):
                    continue
                line_no = msg.get("line", 1)
                text = msg.get("message", "")
                sev_num = msg.get("severity", 1)

                if "floating-promises" in rule_id or "misused-promises" in rule_id:
                    category = f"ESLINT_AST_{rule_id.split('/')[-1].upper().replace('-', '_')}"
                    severity = "HIGH"
                    suggestion = "Tratar a Promise com `await`, `return` ou `.catch()` (validado via TypeScript Type-Checker AST)."
                elif rule_id == "complexity":
                    category = "ESLINT_CYCLOMATIC_COMPLEXITY"
                    severity = "MEDIUM"
                    suggestion = "Método com alta complexidade ciclomática (>10). Priorizar testes de múltiplos branches (if/else/switch)."
                else:
                    category = f"ESLINT_{rule_id.upper().replace('/', '_').replace('-', '_')}"
                    severity = "HIGH" if sev_num == 2 else "MEDIUM"
                    suggestion = f"Corrigir violação da regra `{rule_id}` apontada pelo ESLint."

                findings.append(
                    AuditFinding(
                        severity=severity,
                        category=category,
                        file=rel_path,
                        line=line_no,
                        message=f"[{rule_id}] {text}",
                        suggestion=suggestion,
                    )
                )

        return findings

    # =========================================================================
    # EXTERNAL READER 2: Jest Coverage JSON Reader (coverage-final.json)
    # =========================================================================
    def run_jest_coverage_json_audit(
        self,
        target_files: List[Path],
        min_line_pct: float = 60.0,
        min_branch_pct: float = 50.0,
    ) -> List[AuditFinding]:
        """
        Runs Jest with `--coverage --coverageReporters=json` on existing specs for `target_files`,
        then parses `coverage/coverage-final.json` to extract exact uncovered methods, lines, and branches.
        """
        findings: List[AuditFinding] = []
        existing_specs: List[str] = []
        spec_to_service: Dict[str, Path] = {}

        for f in target_files:
            spec = f.with_name(f.stem + ".spec.ts")
            if spec.exists():
                rel_spec = str(spec.relative_to(self.project_path))
                existing_specs.append(rel_spec)
                spec_to_service[str(f.resolve())] = f

        if not existing_specs:
            return findings

        cmd = [
            "npx",
            "jest",
            "--config",
            "jest.config.json",
            "--coverage",
            "--coverageReporters=json",
            *existing_specs,
        ]
        try:
            subprocess.run(
                cmd,
                cwd=str(self.project_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=120,
            )
        except Exception:
            return findings

        for service_path in spec_to_service.values():
            cov_info = self.get_file_coverage_from_json(service_path)
            if not cov_info:
                continue
            rel_service = str(service_path.relative_to(self.project_path))
            stmt_pct = cov_info["stmt_pct"]
            branch_pct = cov_info["branch_pct"]
            uncovered_lines = cov_info["uncovered_lines"]
            uncovered_fns = cov_info["uncovered_functions"]

            if stmt_pct < min_line_pct:
                fn_list = ", ".join(uncovered_fns) if uncovered_fns else "nenhum método inteiro"
                line_ranges = _format_line_ranges(uncovered_lines)
                findings.append(
                    AuditFinding(
                        severity="HIGH" if stmt_pct < 35.0 else "MEDIUM",
                        category="JEST_COVERAGE_GAP",
                        file=rel_service,
                        line=uncovered_lines[0] if uncovered_lines else 1,
                        message=(
                            f"Cobertura de instruções em {stmt_pct:.1f}% (meta: {min_line_pct:.0f}%) | "
                            f"Branches: {branch_pct:.1f}%. Métodos não executados: [{fn_list}]. "
                            f"Linhas descobertas: [{line_ranges}]."
                        ),
                        suggestion=(
                            f"Criar cenários unitários cobrindo as linhas [{line_ranges}] "
                            f"e os métodos [{fn_list}]."
                        ),
                    )
                )
            elif branch_pct < min_branch_pct and cov_info["total_branches"] >= 4:
                line_ranges = _format_line_ranges(uncovered_lines)
                findings.append(
                    AuditFinding(
                        severity="MEDIUM",
                        category="JEST_BRANCH_COVERAGE_GAP",
                        file=rel_service,
                        line=uncovered_lines[0] if uncovered_lines else 1,
                        message=(
                            f"Cobertura de linhas boa ({stmt_pct:.1f}%), mas cobertura de branches (if/else/try) "
                            f"baixa: {branch_pct:.1f}% ({cov_info['covered_branches']}/{cov_info['total_branches']}). "
                            f"Linhas de desvio não cobertas: [{line_ranges}]."
                        ),
                        suggestion=f"Adicionar testes de caminhos alternativos/exceções nas linhas [{line_ranges}].",
                    )
                )

        return findings

    def get_file_coverage_from_json(self, service_path: Path) -> Optional[Dict[str, Any]]:
        """Reads `coverage/coverage-final.json` and extracts exact coverage metrics + uncovered lines/methods for `service_path`."""
        cov_file = self.project_path / "coverage" / "coverage-final.json"
        if not cov_file.exists():
            return None
        try:
            data = json.loads(cov_file.read_text(encoding="utf-8"))
        except Exception:
            return None

        target_resolved = str(service_path.resolve())
        entry = data.get(target_resolved)
        if not entry:
            for k, v in data.items():
                if k.endswith(service_path.name):
                    entry = v
                    break
        if not entry:
            return None

        stmt_map = entry.get("statementMap", {})
        s_counts = entry.get("s", {})
        fn_map = entry.get("fnMap", {})
        f_counts = entry.get("f", {})
        branch_map = entry.get("branchMap", {})
        b_counts = entry.get("b", {})

        total_stmts = len(s_counts)
        covered_stmts = sum(1 for count in s_counts.values() if count > 0)
        stmt_pct = (covered_stmts / total_stmts * 100.0) if total_stmts > 0 else 100.0

        uncovered_lines: List[int] = []
        for stmt_id, count in s_counts.items():
            if count == 0 and stmt_id in stmt_map:
                start_line = stmt_map[stmt_id].get("start", {}).get("line")
                end_line = stmt_map[stmt_id].get("end", {}).get("line", start_line)
                if start_line:
                    for ln in range(start_line, (end_line or start_line) + 1):
                        uncovered_lines.append(ln)

        uncovered_functions: List[str] = []
        for fn_id, count in f_counts.items():
            if count == 0 and fn_id in fn_map:
                fn_name = fn_map[fn_id].get("name", "")
                if fn_name and not fn_name.startswith("("):
                    uncovered_functions.append(fn_name)

        total_branches = 0
        covered_branches = 0
        for br_id, counts in b_counts.items():
            for idx, c in enumerate(counts):
                total_branches += 1
                if c > 0:
                    covered_branches += 1
                elif br_id in branch_map:
                    loc = branch_map[br_id].get("locations", [])
                    if idx < len(loc):
                        ln = loc[idx].get("start", {}).get("line")
                        if ln:
                            uncovered_lines.append(ln)

        branch_pct = (covered_branches / total_branches * 100.0) if total_branches > 0 else 100.0

        return {
            "stmt_pct": stmt_pct,
            "branch_pct": branch_pct,
            "total_branches": total_branches,
            "covered_branches": covered_branches,
            "uncovered_lines": sorted(set(uncovered_lines)),
            "uncovered_functions": uncovered_functions,
            "uncovered_ranges_str": _format_line_ranges(uncovered_lines),
        }

    # =========================================================================
    # EXTERNAL READER 3: SonarQube JSON Report Reader
    # =========================================================================
    def load_sonarqube_json(
        self,
        sonar_json_path: Path,
        module_filter: Optional[List[str]] = None,
    ) -> List[AuditFinding]:
        """
        Reads a SonarQube / SonarCloud JSON export (`/api/issues/search` format)
        and converts issues into `AuditFinding` items for `ai-pipeline`.
        """
        findings: List[AuditFinding] = []
        if not sonar_json_path.exists():
            return findings
        try:
            payload = json.loads(sonar_json_path.read_text(encoding="utf-8"))
        except Exception:
            return findings

        issues = payload.get("issues", [])
        severity_map = {
            "BLOCKER": "HIGH",
            "CRITICAL": "HIGH",
            "MAJOR": "MEDIUM",
            "MINOR": "LOW",
            "INFO": "LOW",
        }
        for issue in issues:
            component = issue.get("component", "")
            file_path = component.split(":", 1)[-1] if ":" in component else component
            if module_filter and not any(m.lower() in file_path.lower() for m in module_filter):
                continue
            sonar_sev = issue.get("severity", "MAJOR")
            rule = issue.get("rule", "sonar:unknown")
            line = issue.get("line", 1)
            msg = issue.get("message", "")
            issue_type = issue.get("type", "CODE_SMELL")
            findings.append(
                AuditFinding(
                    severity=severity_map.get(sonar_sev, "MEDIUM"),
                    category=f"SONAR_{issue_type}",
                    file=file_path,
                    line=line,
                    message=f"[{rule}] {msg}",
                    suggestion="Criar teste cobrindo este ponto de atenção ou refatorar conforme regra do SonarQube.",
                )
            )
        return findings
