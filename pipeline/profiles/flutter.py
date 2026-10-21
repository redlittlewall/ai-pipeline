from pathlib import Path
import re
from typing import List
from pipeline.profiles.base_profile import ProjectProfile


class FlutterProfile(ProjectProfile):
    @property
    def name(self) -> str:
        return "flutter"

    def is_applicable(self, project_path: Path) -> bool:
        pubspec = project_path / "pubspec.yaml"
        return pubspec.exists()

    def get_test_command(self, spec_file: str) -> List[str]:
        return ["flutter", "test", spec_file]

    def get_prompt_template_path(self) -> Path:
        base_dir = Path(__file__).parent.parent.parent
        return base_dir / "templates" / "flutter_prompt.txt"

    def get_golden_template(self, project_path: Path) -> str:
        # Search for any existing unit test in test/ directory
        test_dir = project_path / "test"
        if test_dir.exists():
            for test_file in test_dir.rglob("*_test.dart"):
                try:
                    with open(test_file, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception:
                    continue
        return "// Flutter golden reference template not found."

    def get_service_file_pattern(self) -> re.Pattern:
        # Matches services, repositories, usecases, controllers
        return re.compile(r"^(.+)[._](service|repository|usecase|controller)\.dart$", re.IGNORECASE)

    def get_expected_spec_path(self, service_file: Path) -> Path:
        # In Flutter, tests commonly live in test/ mirrored from lib/
        return service_file.with_name(f"{service_file.stem}_test.dart")

    def get_source_root(self, project_path: Path) -> Path:
        return project_path / "lib"
