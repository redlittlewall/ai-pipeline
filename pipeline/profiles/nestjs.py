import json
from pathlib import Path
import re
from typing import List, Optional
from pipeline.profiles.base_profile import ProjectProfile


class NestJSProfile(ProjectProfile):
    @property
    def name(self) -> str:
        return "nestjs"

    def is_applicable(self, project_path: Path) -> bool:
        pkg_file = project_path / "package.json"
        if not pkg_file.exists():
            return False
        try:
            with open(pkg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                return any("nestjs" in dep for dep in deps)
        except Exception:
            return False

    def get_test_command(self, spec_file: str, service_file: Optional[str] = None) -> List[str]:
        cmd = ["npx", "jest", "--config", "jest.config.json"]
        if service_file:
            cmd.extend([
                "--coverage",
                f"--collectCoverageFrom={service_file}",
                "--coverageReporters=text",
                "--coverageReporters=json",
            ])
        cmd.append(spec_file)
        return cmd

    def get_prompt_template_path(self) -> Path:
        base_dir = Path(__file__).parent.parent.parent
        return base_dir / "templates" / "nestjs_prompt.txt"

    def get_golden_template(self, project_path: Path) -> str:
        return """  describe('exampleMethod', () => {
    it('should execute successfully and return result (Happy Path)', async () => {
      // Given (Arrange)
      repo.findOne.mockResolvedValue({ id: '123' } as any);

      // When (Act)
      const result = await service.exampleMethod('123');

      // Then (Assert)
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: '123' } });
      expect(result).toBeDefined();
    });

    it('should throw exception when entity is not found (Sad Path)', async () => {
      // Given (Arrange)
      repo.findOne.mockResolvedValue(null);

      // When & Then (Act & Assert)
      await expect(service.exampleMethod('invalid-id')).rejects.toThrow();
    });
  });"""

    def get_service_file_pattern(self) -> re.Pattern:
        return re.compile(r"^(.+)[._]service\.ts$", re.IGNORECASE)

    def get_expected_spec_path(self, service_file: Path) -> Path:
        return service_file.with_name(f"{service_file.stem}.spec.ts")

    def get_source_root(self, project_path: Path) -> Path:
        return project_path / "src"
