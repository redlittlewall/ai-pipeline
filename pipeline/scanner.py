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

    def scan_services(
        self,
        domain_filter: Optional[List[str]] = None,
        include_broken: bool = False,
        include_shallow: bool = False,
        layers: Optional[List[str]] = None,
    ) -> List[Task]:
        if not self.source_root.exists():
            raise FileNotFoundError(f"Source directory not found: {self.source_root}")

        tasks: List[Task] = []
        task_counter = 1
        service_pattern = self.profile.get_service_file_pattern()
        active_layers = layers or ["services"]

        layer_patterns = {
            "services": service_pattern,
            "workflows": re.compile(r".*workflow\.ts$", re.IGNORECASE),
            "controllers": re.compile(r".*controller\.ts$", re.IGNORECASE),
            "guards": re.compile(r".*(?:guard|interceptor|pipe|middleware)\.ts$", re.IGNORECASE),
        }

        # Find all source files recursively
        extension = "*.dart" if self.profile.name == "flutter" else "*.ts"
        for file_path in sorted(self.source_root.rglob(extension)):
            # Skip if it's already a test file
            name_lower = file_path.name.lower()
            if (
                ".spec." in name_lower
                or ".test." in name_lower
                or name_lower.endswith(".spec.ts")
                or name_lower.endswith(".test.ts")
                or name_lower.endswith(".spec.dart")
                or name_lower.endswith(".test.dart")
                or name_lower.startswith("test_")
                or name_lower.startswith("spec_")
                or "__tests__" in str(file_path).lower()
            ):
                continue

            # Skip deprecated, seed, and fixture paths
            if any(part.lower() in ["seeds", "seed", "fixtures"] or "deprecated" in part.lower() for part in file_path.parts):
                continue

            if "all" in active_layers:
                matched = any(p.match(file_path.name) for p in layer_patterns.values())
            else:
                matched = any(
                    layer_patterns[layer].match(file_path.name)
                    for layer in active_layers
                    if layer in layer_patterns
                )
            if not matched:
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
                spec_to_check = expected_spec if expected_spec.exists() else legacy_spec_in_test
                rel_spec = str(spec_to_check.relative_to(self.project_path))
                is_requeued = False

                if include_shallow:
                    try:
                        spec_code = spec_to_check.read_text(encoding="utf-8")
                        it_count = len(re.findall(r"\b(?:it|test)\s*\(", spec_code))
                        todo_count = len(re.findall(r"//\s*TODO:", spec_code))
                        if it_count <= 1 or todo_count > 0:
                            print(
                                f"🔍 [SHALLOW SPEC DETECTED]: {rel_spec} (it={it_count}, TODOs={todo_count}). "
                                f"Queueing for deep test expansion..."
                            )
                            quarantine_file = (
                                Path(__file__).resolve().parent.parent
                                / "reports"
                                / "quarantine"
                                / module_name
                                / expected_spec.name
                            )
                            # Remove shallow quarantine copy so worker generates fresh Proxy-QueryBuilder scaffold
                            if quarantine_file.exists():
                                q_it_count = len(
                                    re.findall(r"\b(?:it|test)\s*\(", quarantine_file.read_text(encoding="utf-8"))
                                )
                                if q_it_count <= 1:
                                    quarantine_file.unlink()
                            spec_to_check.unlink()
                            is_requeued = True
                    except Exception:
                        pass

                if not is_requeued:
                    if not include_broken:
                        continue
                    import subprocess
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
