#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys

from pipeline.auditor import StaticQualityAuditor
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
    scan_parser.add_argument(
        "--module",
        default=None,
        help="Comma-separated list of specific modules to scan (e.g. 'payment,order')",
    )
    scan_parser.add_argument(
        "--layer",
        default="services",
        help="Comma-separated layers to scan: services,workflows,controllers,guards,all (default: services)",
    )
    scan_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")
    scan_parser.add_argument(
        "--include-broken",
        action="store_true",
        help="Verify existing spec files and queue broken ones for autonomous repair",
    )
    scan_parser.add_argument(
        "--include-shallow",
        action="store_true",
        help="Detect shallow specs (only 'should be defined' or pending // TODO blocks) and re-queue them",
    )
    scan_parser.add_argument(
        "--clean-pending",
        action="store_true",
        help="Remove existing pending tasks from queue before adding newly scanned tasks (keeps completed tasks)",
    )

    # Command: audit
    audit_parser = subparsers.add_parser("audit", help="Run Static Quality Auditor + External Report Readers")
    audit_parser.add_argument("--target", required=True, help="Path to target project (e.g. /path/to/tattoopop-api)")
    audit_parser.add_argument(
        "--module",
        default="tattoo,auth,configurations",
        help="Comma-separated modules to audit (default: tattoo,auth,configurations)",
    )
    audit_parser.add_argument("--limit", type=int, default=20, help="Max files to audit in this sample run")
    audit_parser.add_argument(
        "--eslint",
        action="store_true",
        help="Run ESLint TypeScript AST reader (floating promises, cyclomatic complexity) in JSON mode",
    )
    audit_parser.add_argument(
        "--coverage",
        action="store_true",
        help="Run Jest Coverage JSON reader (coverage-final.json) to pinpoint exact uncovered lines/methods",
    )
    audit_parser.add_argument(
        "--sonar-json",
        default=None,
        help="Path to an external SonarQube JSON report (/api/issues/search format) to ingest",
    )

    # Command: run
    run_parser = subparsers.add_parser("run", help="Run batch test generation worker")
    run_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")
    run_parser.add_argument("--limit", type=int, default=None, help="Maximum number of tasks to process in this run")
    run_parser.add_argument(
        "--module",
        default=None,
        help="Optional comma-separated module filter (e.g. 'tattoo,auth,configurations')",
    )
    run_parser.add_argument("--model", default="ollama/qwen2.5-coder:14b", help="Model to use (e.g. groq/openai/gpt-oss-120b or ollama/qwen2.5-coder:14b)")
    run_parser.add_argument("--timeout", type=int, default=360, help="Per-task timeout in seconds")
    run_parser.add_argument("--retry-failed", action="store_true", help="Reset all failed tasks to pending before running")
    run_parser.add_argument(
        "--log-level",
        choices=["compact", "verbose", "quiet"],
        default="compact",
        help="Logging verbosity: 'compact' (essential progress & errors), 'verbose' (full prompts, attempt history, full tracebacks), or 'quiet' (minimal one-liners)",
    )
    run_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Shortcut for --log-level verbose (full prompt & debugging logs)",
    )

    # Command: retry-failed
    retry_parser = subparsers.add_parser("retry-failed", help="Reset all failed tasks to pending")
    retry_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")

    # Command: status
    status_parser = subparsers.add_parser("status", help="Show current queue status")
    status_parser.add_argument("--queue-file", default="queue.json", help="Path to queue.json file")

    # Command: benchmark
    bench_parser = subparsers.add_parser(
        "benchmark",
        help="Run benchmark across models on the curated 10-service Golden Set",
    )
    bench_parser.add_argument(
        "--golden-set",
        action="store_true",
        default=True,
        help="Benchmark on the curated 10-service Golden Set (default: True)",
    )
    bench_parser.add_argument(
        "--models",
        required=True,
        help="Comma-separated list of models (e.g. 'gemini-2.5-flash,groq/openai/gpt-oss-120b,ollama/qwen2.5-coder:14b')",
    )
    bench_parser.add_argument(
        "--target",
        default=None,
        help="Path to target project (defaults to project_path from queue.json or /Users/redguy/TattooPop/tattoopop-api)",
    )
    bench_parser.add_argument(
        "--queue-file",
        default="queue.json",
        help="Reference queue.json path (only used to infer target project if --target is omitted)",
    )
    bench_parser.add_argument(
        "--max-attempts",
        type=int,
        default=3,
        help="Max attempts per service in benchmark (default: 3)",
    )
    bench_parser.add_argument(
        "--timeout",
        type=int,
        default=360,
        help="Per-task timeout in seconds (default: 360)",
    )
    bench_parser.add_argument(
        "--log-level",
        choices=["compact", "verbose", "quiet"],
        default="compact",
        help="Logging verbosity: 'compact', 'verbose', or 'quiet'",
    )
    bench_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Shortcut for --log-level verbose",
    )

    args = parser.parse_args()

    if args.command == "scan":
        scanner = ProjectScanner(Path(args.target), profile_name=args.profile)
        if args.module:
            domains = [m.strip() for m in args.module.split(",") if m.strip()]
        else:
            domains = CORE_DOMAINS if args.domain == "core" else None
        layers = [l.strip().lower() for l in args.layer.split(",") if l.strip()]
        tasks = scanner.scan_services(
            domain_filter=domains,
            include_broken=args.include_broken,
            include_shallow=args.include_shallow,
            layers=layers,
        )
        qm = QueueManager(Path(args.queue_file))
        if args.clean_pending:
            removed = qm.clear_pending_tasks()
            print(f"🧹 Removed {removed} previously pending tasks from {args.queue_file}.")
        reopen = bool(args.include_broken or args.include_shallow)
        added = qm.add_tasks(tasks, reopen_existing=reopen)
        print(f"✅ Scanned project at: {args.target}")
        print(f"Framework Profile: {scanner.profile.name} | Layers: {layers}")
        print(f"Found {len(tasks)} untested/broken/shallow targets.")
        print(f"Added/Reopened {added} tasks in {args.queue_file}.")
        print(f"Current Queue Status: {qm.get_summary()}")

    elif args.command == "audit":
        auditor = StaticQualityAuditor(Path(args.target))
        modules = [m.strip() for m in args.module.split(",") if m.strip()] if args.module else None
        sonar_path = Path(args.sonar_json) if args.sonar_json else None
        findings = auditor.audit_files(
            module_filter=modules,
            limit=args.limit,
            run_eslint=args.eslint,
            run_coverage=args.coverage,
            sonar_json_path=sonar_path,
        )
        print(
            f"🔍 Quality Audit on {args.target} "
            f"(modules={modules}, limit={args.limit}, eslint={args.eslint}, coverage={args.coverage})"
        )
        print(f"Total findings: {len(findings)}\n")
        for f in findings:
            icon = "🔴" if f.severity == "HIGH" else ("🟡" if f.severity == "MEDIUM" else "🔵")
            print(f"{icon} [{f.severity}] [{f.category}] {f.file}:{f.line}")
            print(f"   ↳ {f.message}")
            print(f"   💡 Sugestão: {f.suggestion}\n")

    elif args.command == "run":
        qm = QueueManager(Path(args.queue_file))
        if args.retry_failed:
            reset_count = qm.reset_failed_tasks()
            print(f"🔄 Reset {reset_count} failed tasks to pending.")
        modules = [m.strip() for m in args.module.split(",") if m.strip()] if args.module else None
        log_level = "verbose" if getattr(args, "verbose", False) else args.log_level
        worker = TaskWorker(model=args.model, timeout_seconds=args.timeout, log_level=log_level)
        runner = BatchRunner(queue_manager=qm, worker=worker)
        runner.run_batch(max_tasks=args.limit, module_filter=modules)

    elif args.command == "retry-failed":
        qm = QueueManager(Path(args.queue_file))
        reset_count = qm.reset_failed_tasks()
        print(f"🔄 Reset {reset_count} failed tasks to pending.")
        print(f"Queue Status ({args.queue_file}): {qm.get_summary()}")

    elif args.command == "status":
        qm = QueueManager(Path(args.queue_file))
        print(f"Queue Status ({args.queue_file}): {qm.get_summary()}")

    elif args.command == "benchmark":
        model_list = [m.strip() for m in args.models.split(",") if m.strip()]
        if not model_list:
            print("❌ No models provided. Specify at least one model via --models.")
            sys.exit(1)

        target_path = Path(args.target) if args.target else None
        if not target_path:
            qm = QueueManager(Path(args.queue_file))
            existing = qm.load_queue()
            if existing:
                target_path = Path(existing[0].project_path)
            else:
                target_path = Path("/Users/redguy/TattooPop/tattoopop-api")

        log_level = "verbose" if getattr(args, "verbose", False) else args.log_level

        from pipeline.benchmark import BenchmarkHarness
        harness = BenchmarkHarness(
            project_path=target_path,
            models=model_list,
            max_attempts=args.max_attempts,
            timeout=args.timeout,
            log_level=log_level,
        )
        harness.run_benchmark()


if __name__ == "__main__":
    main()
