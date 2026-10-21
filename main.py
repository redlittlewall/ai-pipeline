#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys

from pipeline.queue_manager import QueueManager
from pipeline.runner import BatchRunner
from pipeline.scanner import CORE_DOMAINS, ProjectScanner
from pipeline.worker import TaskWorker


def main():
    parser = argparse.ArgumentParser(description="Autonomous AI Code Testing Pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Command: scan
    scan_parser = subparsers.add_parser("scan", help="Scan target project and populate queue")
    scan_parser.add_argument("--target", required=True, help="Path to target project (e.g. /path/to/tattoopop-api)")
    scan_parser.add_argument(
        "--profile",
        choices=["nestjs", "flutter", "svelte"],
        default=None,
        help="Framework profile (auto-detected if omitted)",
    )
    scan_parser.add_argument(
        "--domain",
        choices=["core", "all"],
        default="core",
        help="Domain scope: 'core' (customer, tattoo, auth, configurations) or 'all'",
    )
    scan_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")

    # Command: run
    run_parser = subparsers.add_parser("run", help="Run batch test generation worker")
    run_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")
    run_parser.add_argument("--limit", type=int, default=None, help="Maximum number of tasks to process in this run")
    run_parser.add_argument("--model", default="ollama/qwen2.5:14b", help="Ollama model to use")
    run_parser.add_argument("--timeout", type=int, default=240, help="Per-task timeout in seconds")

    # Command: status
    status_parser = subparsers.add_parser("status", help="Show current queue status")
    status_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")

    args = parser.parse_args()

    if args.command == "scan":
        scanner = ProjectScanner(Path(args.target), profile_name=args.profile)
        domains = CORE_DOMAINS if args.domain == "core" else None
        tasks = scanner.scan_services(domain_filter=domains)
        qm = QueueManager(Path(args.queue_file))
        added = qm.add_tasks(tasks)
        print(f"✅ Scanned project at: {args.target}")
        print(f"Framework Profile: {scanner.profile.name}")
        print(f"Found {len(tasks)} untested services in '{args.domain}' domain.")
        print(f"Added {added} new tasks to {args.queue_file}.")
        print(f"Current Queue Status: {qm.get_summary()}")

    elif args.command == "run":
        qm = QueueManager(Path(args.queue_file))
        worker = TaskWorker(model=args.model, timeout_seconds=args.timeout)
        runner = BatchRunner(queue_manager=qm, worker=worker)
        runner.run_batch(max_tasks=args.limit)

    elif args.command == "status":
        qm = QueueManager(Path(args.queue_file))
        print(f"Queue Status ({args.queue_file}): {qm.get_summary()}")


if __name__ == "__main__":
    main()
