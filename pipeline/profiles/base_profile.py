from abc import ABC, abstractmethod
from pathlib import Path
import re
from typing import List, Optional


class ProjectProfile(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the profile (e.g. 'nestjs', 'flutter', 'svelte')."""
        pass

    @abstractmethod
    def is_applicable(self, project_path: Path) -> bool:
        """Returns True if the given project directory matches this framework profile."""
        pass

    @abstractmethod
    def get_test_command(self, spec_file: str, service_file: Optional[str] = None) -> List[str]:
        """Returns the command list to run test verification on a specific test file."""
        pass

    @abstractmethod
    def get_prompt_template_path(self) -> Path:
        """Returns the path to the framework-specific prompt template."""
        pass

    @abstractmethod
    def get_golden_template(self, project_path: Path) -> str:
        """Loads and returns the golden reference test content for prompt injection."""
        pass

    @abstractmethod
    def get_service_file_pattern(self) -> re.Pattern:
        """Returns regex pattern to identify services/classes that require unit tests."""
        pass

    @abstractmethod
    def get_expected_spec_path(self, service_file: Path) -> Path:
        """Returns the expected spec file path given a service file path."""
        pass

    @abstractmethod
    def get_source_root(self, project_path: Path) -> Path:
        """Returns the source root directory to scan (e.g. project_path / 'src' or 'lib')."""
        pass
