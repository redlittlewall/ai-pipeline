import argparse
from pathlib import Path
import re
from typing import List, Optional
from pipeline.queue_manager import QueueManager, Task

CORE_DOMAINS = ["customer", "tattoo", "auth", "configurations"]


class ProjectScanner:
    def __init__(self, project_path: Path):
        self.project_path = Path(project_path).resolve()
        self.src_path = self.project_path / "src"

    def scan_services(self, domain_filter: Optional[List[str]] = None) -> List[Task]:
        if not self.src_path.exists():
            raise FileNotFoundError(f"Source directory not found: {self.src_path}")

        tasks: List[Task] = []
        task_counter = 1

        # Match files ending in service.ts (case-insensitive)
        service_pattern = re.compile(r"^(.+)[._]service\.ts$", re.IGNORECASE)

        for file_path in sorted(self.src_path.rglob("*.ts")):
            match = service_pattern.match(file_path.name)
            if not match:
                # Also check direct 'AuthService.ts' or 'ViewAddressService.ts'
                if file_path.name.lower().endswith("service.ts") and not file_path.name.lower().endswith("spec.ts"):
                    base_name = file_path.stem
                else:
                    continue
            else:
                base_name = match.group(1)

            # Determine module name from directory hierarchy
            relative_path = file_path.relative_to(self.project_path)
            parts = relative_path.parts
            module_name = "general"
            if "modules" in parts:
                idx = parts.index("modules")
                if idx + 1 < len(parts):
                    module_name = parts[idx + 1]

            # Domain filtering if specified
            if domain_filter:
                matches_domain = any(
                    df.lower() in module_name.lower() or df.lower() in str(relative_path).lower()
                    for df in domain_filter
                )
                if not matches_domain:
                    continue

            # Check if spec file already exists
            expected_spec = file_path.with_name(f"{file_path.stem}.spec.ts")
            legacy_spec_in_test = self.project_path / "test" / relative_path.parent / f"{file_path.stem}.spec.ts"

            if expected_spec.exists() or legacy_spec_in_test.exists():
                continue

            task_id = f"TASK-{task_counter:03d}"
            task_counter += 1

            tasks.append(
                Task(
                    id=task_id,
                    project_path=str(self.project_path),
                    service_file=str(relative_path),
                    spec_file=str(expected_spec.relative_to(self.project_path)),
                    module_name=module_name,
                    status="pending",
                )
            )

        return tasks


def main():
    parser = argparse.ArgumentParser(description="Scan project for untested services and populate queue.")
    parser.add_argument("--target", required=True, help="Path to target project (e.g. /path/to/tattoopop-api)")
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

    scanner = ProjectScanner(Path(args.target))
    domains = CORE_DOMAINS if args.domain == "core" else None
    tasks = scanner.scan_services(domain_filter=domains)

    queue_mgr = QueueManager(Path(args.queue_file))
    added = queue_mgr.add_tasks(tasks)

    print(f"Scanned project at: {args.target}")
    print(f"Found {len(tasks)} untested services in '{args.domain}' domain.")
    print(f"Added {added} new tasks to {args.queue_file}.")
    summary = queue_mgr.get_summary()
    print(f"Queue Status: {summary}")


if __name__ == "__main__":
    main()
