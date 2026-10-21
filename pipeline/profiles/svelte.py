import json
from pathlib import Path
import re
from typing import List
from pipeline.profiles.base_profile import ProjectProfile


class SvelteProfile(ProjectProfile):
    @property
    def name(self) -> str:
        return "svelte"

    def is_applicable(self, project_path: Path) -> bool:
        if (project_path / "svelte.config.js").exists():
            return True
        pkg_file = project_path / "package.json"
        if pkg_file.exists():
            try:
                with open(pkg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                    return any("svelte" in dep for dep in deps)
            except Exception:
                pass
        return False

    def get_test_command(self, spec_file: str) -> List[str]:
        return ["npx", "vitest", "run", spec_file]

    def get_prompt_template_path(self) -> Path:
        base_dir = Path(__file__).parent.parent.parent
        return base_dir / "templates" / "svelte_prompt.txt"

    def get_golden_template(self, project_path: Path) -> str:
        src_dir = project_path / "src"
        if src_dir.exists():
            for test_file in src_dir.rglob("*.test.ts"):
                try:
                    with open(test_file, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception:
                    continue
        return "// Svelte golden reference template not found."

    def get_service_file_pattern(self) -> re.Pattern:
        return re.compile(r"^(.+)[._](service|store|util|api)\.ts$", re.IGNORECASE)

    def get_expected_spec_path(self, service_file: Path) -> Path:
        return service_file.with_name(f"{service_file.stem}.test.ts")

    def get_source_root(self, project_path: Path) -> Path:
        return project_path / "src"
