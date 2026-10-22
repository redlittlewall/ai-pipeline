from pathlib import Path
import re
from typing import Dict, List, Optional


class NestJSScaffolder:
    """Deterministically generates NestJS unit test scaffolds with mocked dependencies (Zero-AI)."""

    def parse_service(self, service_code: str) -> Dict[str, any]:
        # Extract class name
        class_match = re.search(r'export\s+class\s+([A-Za-z0-9_]+)', service_code)
        class_name = class_match.group(1) if class_match else "TargetService"

        # Extract constructor dependencies
        dependencies = []
        ctor_match = re.search(r'constructor\s*\(([\s\S]*?)\)\s*\{', service_code)
        if ctor_match:
            params_block = ctor_match.group(1)
            param_pattern = re.compile(
                r'(?:@InjectRepository\((?P<entity>\w+)\)\s*)?'
                r'(?:private|protected|public)?\s*(?:readonly)?\s*'
                r'(?P<param_name>\w+)\s*:\s*'
                r'(?P<param_type>[A-Za-z0-9_<>]+)'
            )
            for match in param_pattern.finditer(params_block):
                entity = match.group('entity')
                p_name = match.group('param_name')
                p_type = match.group('param_type')
                is_repo = bool(entity) or "Repository<" in p_type
                entity_name = entity or (p_type.replace("Repository<", "").replace(">", "") if "Repository<" in p_type else None)
                dependencies.append({
                    "param_name": p_name,
                    "param_type": p_type,
                    "is_repository": is_repo,
                    "entity_name": entity_name,
                })

        # Extract public methods
        methods = []
        method_pattern = re.compile(
            r'^\s*(?:public\s+)?(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{',
            re.MULTILINE,
        )
        for match in method_pattern.finditer(service_code):
            m_name = match.group(1)
            if m_name not in ["constructor", "if", "while", "for", "switch", "catch"]:
                methods.append({
                    "name": m_name,
                    "params": match.group(2).strip(),
                    "return_type": (match.group(3) or "").strip(),
                })

        # Extract existing imports to reuse exact paths for entities and services
        imported_symbols: Dict[str, str] = {}
        import_pattern = re.compile(r'import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', re.MULTILINE)
        for match in import_pattern.finditer(service_code):
            symbols = [s.strip() for s in match.group(1).split(",")]
            import_path = match.group(2)
            for sym in symbols:
                if sym:
                    # Handle 'as' aliases if any
                    clean_sym = sym.split()[0]
                    imported_symbols[clean_sym] = import_path

        return {
            "class_name": class_name,
            "dependencies": dependencies,
            "methods": methods,
            "imported_symbols": imported_symbols,
        }

    def generate_scaffold(self, service_path: Path, service_code: str) -> str:
        parsed = self.parse_service(service_code)
        class_name = parsed["class_name"]
        dependencies = parsed["dependencies"]
        methods = parsed["methods"]
        imported_symbols = parsed["imported_symbols"]

        # Collect required imports
        needs_typeorm_token = any(d["is_repository"] for d in dependencies)
        import_lines = [
            "import { Test, TestingModule } from '@nestjs/testing';",
        ]
        if needs_typeorm_token:
            import_lines.append("import { getRepositoryToken } from '@nestjs/typeorm';")

        # Import the service itself
        service_import_name = Path(service_path).stem.replace(".service", ".service").replace(".Service", ".service")
        import_lines.append(f"import {{ {class_name} }} from './{Path(service_path).name[:-3]}';")

        # Add imports for entities and service dependencies
        added_symbols = {class_name}
        for dep in dependencies:
            if dep["is_repository"] and dep["entity_name"]:
                entity = dep["entity_name"]
                if entity not in added_symbols and entity in imported_symbols:
                    import_lines.append(f"import {{ {entity} }} from '{imported_symbols[entity]}';")
                    added_symbols.add(entity)
            elif not dep["is_repository"]:
                clean_type = dep["param_type"]
                if clean_type not in added_symbols and clean_type in imported_symbols:
                    import_lines.append(f"import {{ {clean_type} }} from '{imported_symbols[clean_type]}';")
                    added_symbols.add(clean_type)

        # Build mock variables and provider configurations
        let_declarations = [f"  let service: {class_name};"]
        mock_assignments = []
        providers_list = [f"        {class_name},"]

        has_repos = any(d["is_repository"] for d in dependencies)
        if has_repos:
            mock_assignments.extend([
                "    const createQueryBuilderMock = () => {",
                "      const qb: any = new Proxy({}, {",
                "        get(target, prop) {",
                "          if (prop === 'then') return undefined;",
                "          if (!(prop in target)) {",
                "            target[prop] = jest.fn().mockReturnValue(qb);",
                "          }",
                "          return target[prop];",
                "        },",
                "      });",
                "      qb.getOne = jest.fn().mockResolvedValue(null);",
                "      qb.getMany = jest.fn().mockResolvedValue([]);",
                "      qb.getRawOne = jest.fn().mockResolvedValue(null);",
                "      qb.getRawMany = jest.fn().mockResolvedValue([]);",
                "      qb.getCount = jest.fn().mockResolvedValue(0);",
                "      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);",
                "      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });",
                "      return qb;",
                "    };",
            ])

        for dep in dependencies:
            p_name = dep["param_name"]
            let_declarations.append(f"  let {p_name}: any;")

            if dep["is_repository"]:
                entity = dep["entity_name"]
                mock_assignments.extend([
                    f"    const {p_name}QueryBuilder = createQueryBuilderMock();",
                    f"    {p_name} = {{",
                    f"      findOne: jest.fn(),",
                    f"      find: jest.fn(),",
                    f"      findAndCount: jest.fn(),",
                    f"      save: jest.fn(),",
                    f"      create: jest.fn(),",
                    f"      update: jest.fn(),",
                    f"      delete: jest.fn(),",
                    f"      softDelete: jest.fn(),",
                    f"      restore: jest.fn(),",
                    f"      count: jest.fn(),",
                    f"      exist: jest.fn(),",
                    f"      remove: jest.fn(),",
                    f"      createQueryBuilder: jest.fn().mockReturnValue({p_name}QueryBuilder),",
                    f"    }};",
                ])
                providers_list.extend([
                    f"        {{",
                    f"          provide: getRepositoryToken({entity}),",
                    f"          useValue: {p_name},",
                    f"        }},",
                ])
            else:
                p_type = dep["param_type"]
                called_methods = sorted(set(re.findall(rf'this\.{p_name}\.([a-zA-Z0-9_]+)\(', service_code)))
                if called_methods:
                    method_mocks = [f"      {m}: jest.fn()," for m in called_methods]
                    mock_assignments.extend([
                        f"    {p_name} = {{",
                        *method_mocks,
                        f"    }};",
                    ])
                else:
                    mock_assignments.extend([
                        f"    {p_name} = {{}};",
                    ])
                providers_list.extend([
                    f"        {{",
                    f"          provide: {p_type},",
                    f"          useValue: {p_name},",
                    f"        }},",
                ])

        # Generate describe block for each public method
        method_blocks = []
        for m in methods:
            m_name = m["name"]
            method_blocks.extend([
                f"  describe('{m_name}', () => {{",
                f"    // TODO: Implement Given-When-Then test cases for {m_name}",
                f"  }});",
                f"",
            ])

        methods_str = chr(10).join(method_blocks)

        scaffold = f"""{chr(10).join(import_lines)}

describe('{class_name}', () => {{
{chr(10).join(let_declarations)}

  beforeEach(async () => {{
{chr(10).join(mock_assignments)}

    const module: TestingModule = await Test.createTestingModule({{
      providers: [
{chr(10).join(providers_list)}
      ],
    }}).compile();

    service = module.get<{class_name}>({class_name});
  }});

  it('should be defined', () => {{
    expect(service).toBeDefined();
  }});

{methods_str}
}});
"""
        return scaffold

    def extract_imported_type_context(
        self, project_path: Path, service_path: Path, service_code: str, max_total_chars: int = 2500
    ) -> str:
        """Extracts concise Enum and DTO definitions imported by the service to prevent LLM hallucination."""
        parsed = self.parse_service(service_code)
        imported_symbols = parsed["imported_symbols"]
        src_root = project_path / "src"

        snippets = []
        total_chars = 0

        seen_paths = set()
        for sym, imp_path in imported_symbols.items():
            if imp_path in seen_paths or imp_path.startswith("@") or imp_path == "typeorm":
                continue
            seen_paths.add(imp_path)

            # Focus on Enums, DTOs, and custom Exceptions
            is_relevant = any(
                k in imp_path.lower() or k in sym.lower()
                for k in ["enum", "dto", "exception", "interface", "type"]
            )
            if not is_relevant:
                continue

            candidate: Optional[Path] = None
            if imp_path.startswith("."):
                resolved = (service_path.parent / f"{imp_path}.ts").resolve()
                if resolved.exists():
                    candidate = resolved
            else:
                resolved = (src_root / f"{imp_path}.ts").resolve()
                if resolved.exists():
                    candidate = resolved

            if candidate and candidate.is_file():
                try:
                    content = candidate.read_text(encoding="utf-8").strip()
                    # Keep only compact files (< 1200 chars)
                    if 0 < len(content) <= 1200 and (total_chars + len(content)) <= max_total_chars:
                        snippets.append(f"// import path: '{imp_path}'\n{content}")
                        total_chars += len(content)
                except Exception:
                    pass

        if not snippets:
            return ""
        return "\n\nREFERÊNCIA REAL DE ENUMS E DTOS IMPORTADOS (Use exatamente estes tipos/chaves):\n```typescript\n" + "\n\n".join(snippets) + "\n```"

