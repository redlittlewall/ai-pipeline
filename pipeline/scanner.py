import argparse
from pathlib import Path
import re
from typing import List, Optional
from pipeline.profiles.registry import registry
from pipeline.queue_manager import QueueManager, Task

CORE_DOMAINS = ["customer", "tattoo", "auth", "configurations"]


class ProjectScanner:
    def __init__(self, project_path: Path, profile_name: Optional[str] = None):
        self.project_path = Path(project_path).resolve()
        if profile_name:
            self.profile = registry.get_profile_by_name(profile_name)
            if not self.profile:
                raise ValueError(
                    f"Unknown profile: '{profile_name}'. Available: {registry.list_available_profiles()}"
                )
        else:
            self.profile = registry.detect_profile(self.project_path)

        self.source_root = self.profile.get_source_root(self.project_path)

    def scan_services(self, domain_filter: Optional[List[str]] = None, include_broken: bool = False) -> List[Task]:
        if not self.source_root.exists():
            raise FileNotFoundError(f"Source directory not found: {self.source_root}")

        tasks: List[Task] = []
        task_counter = 1
        service_pattern = self.profile.get_service_file_pattern()

        # Find all source files recursively
        extension = "*.dart" if self.profile.name == "flutter" else "*.ts"
        for file_path in sorted(self.source_root.rglob(extension)):
            # Skip if it's already a test file
            if "spec" in file_path.name.lower() or "test" in file_path.name.lower():
                continue

            match = service_pattern.match(file_path.name)
            if not match:
                continue

            relative_path = file_path.relative_to(self.project_path)
            parts = relative_path.parts

            # Determine module name from directory hierarchy
            module_name = "general"
            for container in ["modules", "app", "features", "packages"]:
                if container in parts:
                    idx = parts.index(container)
                    if idx + 1 < len(parts):
                        module_name = parts[idx + 1]
                        break

            # Domain filtering if specified
            if domain_filter:
                matches_domain = any(
                    df.lower() in module_name.lower() or df.lower() in str(relative_path).lower()
                    for df in domain_filter
                )
                if not matches_domain:
                    continue

            # Check if spec file already exists
            expected_spec = self.profile.get_expected_spec_path(file_path)
            legacy_spec_in_test = self.project_path / "test" / relative_path.parent / expected_spec.name

            if expected_spec.exists() or legacy_spec_in_test.exists():
                if not include_broken:
                    continue
                import subprocess
                spec_to_check = expected_spec if expected_spec.exists() else legacy_spec_in_test
                rel_spec = str(spec_to_check.relative_to(self.project_path))
                cmd = self.profile.get_test_command(rel_spec)
                res = subprocess.run(cmd, cwd=str(self.project_path), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if res.returncode == 0:
                    continue
                print(f"⚠️ [BROKEN SPEC DETECTED]: {rel_spec} failed verification. Queueing for autonomous repair...")
                quarantine_dir = Path(__file__).resolve().parent.parent / "reports" / "quarantine" / module_name
                quarantine_dir.mkdir(parents=True, exist_ok=True)
                (quarantine_dir / expected_spec.name).write_text(spec_to_check.read_text(encoding="utf-8"), encoding="utf-8")
                spec_to_check.unlink()

            # Skip dead or completely commented-out files
            try:
                raw_code = file_path.read_text(encoding="utf-8")
                uncommented = re.sub(r"/\*[\s\S]*?\*/", "", raw_code)
                uncommented_lines = [
                    line for line in uncommented.splitlines()
                    if line.strip() and not line.strip().startswith("//")
                ]
                active_code = "\n".join(uncommented_lines)
                if self.profile.name != "flutter" and "export class" not in active_code:
                    continue
                if not active_code.strip():
                    continue
            except Exception:
                pass

            task_id = f"TASK-{task_counter:03d}"
            task_counter += 1

            tasks.append(
                Task(
                    id=task_id,
                    project_path=str(self.project_path),
                    service_file=str(relative_path),
                    spec_file=str(expected_spec.relative_to(self.project_path)),
                    module_name=module_name,
                    profile=self.profile.name,
                    status="pending",
                )
            )

        return tasks


def main():
    parser = argparse.ArgumentParser(description="Scan project for untested services and populate queue.")
    parser.add_argument("--target", required=True, help="Path to target project (e.g. /path/to/tattoopop-api)")
    parser.add_argument(
        "--profile",
        choices=registry.list_available_profiles(),
        default=None,
        help="Framework profile (auto-detected if omitted)",
    )
    parser.add_argument(
        "--domain",
        choices=["core", "all"],
        default="core",
        help="Domain scope: 'core' (customer, tattoo, auth, configurations) or 'all'",
    )
    parser.add_argument(
        "--queue-file",
        default="queue.json",
        help="Path to queue.json file",
    )

    args = parser.parse_args()

    scanner = ProjectScanner(Path(args.target), profile_name=args.profile)
    domains = CORE_DOMAINS if args.domain == "core" else None
    tasks = scanner.scan_services(domain_filter=domains)

    queue_mgr = QueueManager(Path(args.queue_file))
    added = queue_mgr.add_tasks(tasks)

    print(f"Scanned project at: {args.target}")
    print(f"Detected Profile: {scanner.profile.name}")
    print(f"Found {len(tasks)} untested services in '{args.domain}' domain.")
    print(f"Added {added} new tasks to {args.queue_file}.")
    summary = queue_mgr.get_summary()
    print(f"Queue Status: {summary}")


if __name__ == "__main__":
    main()
