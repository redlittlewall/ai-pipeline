# Specification: Autonomous Local Testing & Quality Pipeline (ai-pipeline)

## Problem Statement

As a software engineer maintaining multiple production-bound applications (including the TattooPop NestJS API, Flutter mobile app, and Svelte web frontend), writing comprehensive unit test suites and maintaining strict code standards requires significant manual effort and repetitive boilerplate authoring (such as dependency injection mocks, DTO setup, and edge case assertions). Because of time constraints, several critical business modules lack sufficient unit test coverage.

While cloud-based LLM APIs respond quickly, utilizing them continuously for extensive batch testing across large codebases is cost-prohibitive, subject to rate limits, and requires sending proprietary source code over the network. Conversely, running capable open-source models (such as Qwen 2.5 14B) locally on Apple Silicon via Ollama provides complete privacy and zero operational cost, but exhibits higher latency in interactive chat workflows. Furthermore, running local models without a structured autonomous harness risks non-deterministic results: models may modify business logic to pass tests ("cheating"), write shallow assertions (`expect(true).toBe(true)`), enter infinite retry loops, or pollute Git histories.

## Solution

A standalone, local autonomous orchestrator (`ai-pipeline`) hosted in its own Git repository (`Documents/ai-pipeline`). The orchestrator runs in background or unattended batch mode on macOS, leveraging local LLMs (Ollama running Qwen 2.5 14B with expanded context) through a headless agent runner (Aider). 

The system systematically scans target codebases, populates a task queue for untested core business services, creates isolated Git branches, synthesizes comprehensive unit tests against a validated "golden reference template", validates each test through the target project's native test runner (Jest), and auto-corrects failures up to a bounded circuit-breaker threshold. Production code is strictly enforced as read-only during test generation. Once verified, atomic commits are recorded on a dedicated local thematic branch, and a consolidated Markdown summary report is produced for developer review, ensuring zero unauthorized pushes to remote repositories.

## User Stories

1. As a developer, I want to execute the pipeline pointing to any local repository path via a CLI flag, so that I can reuse the same automation engine across NestJS, Flutter, and Svelte projects without embedding scripts inside application repositories.
2. As a developer, I want the pipeline to automatically discover services lacking unit test files, so that I don't have to manually curate a list of target files.
3. As a developer, I want to prioritize test generation for core business domains (e.g., Customer, Tattoo, Auth) before infrastructure modules, so that high-impact areas receive coverage first.
4. As a developer, I want each test generation task to reference a validated "golden test" template, so that the generated specs adhere to the project's existing conventions for dependency injection, module configuration, and mocks.
5. As a developer, I want the pipeline to strictly treat production implementation files as read-only during test generation, so that the LLM cannot alter business logic to artificially satisfy failing tests.
6. As a developer, I want the pipeline to execute the project's native test runner (e.g., Jest with explicit configuration) immediately after generating a test, so that validity is confirmed by code execution rather than LLM speculation.
7. As a developer, I want the pipeline to feed runtime error tracebacks back into the model when a test fails, so that the agent can autonomously self-correct compilation, syntax, or mock errors.
8. As a developer, I want the self-healing loop to be bounded to a maximum of 3 attempts per file, so that the agent does not waste system resources or enter infinite retry loops on stubborn modules.
9. As a developer, I want the pipeline to discard any failed test file (`git checkout -- <file>`) if it cannot pass within the retry limit, so that the target repository remains in a clean, buildable state.
10. As a developer, I want all successfully verified tests to be committed atomically to a dedicated local thematic branch (e.g., `feat/ai-unit-tests-api`), so that each service test has a clear, isolated commit history.
11. As a developer, I want the pipeline to operate strictly on local branches without pushing to remote remotes (`git push`), so that no unverified or automated code reaches shared repositories without human inspection.
12. As a developer, I want a comprehensive Markdown execution report generated in a `reports/` directory at the end of each run, so that I can immediately inspect which services passed, which failed, and the number of tests created.
13. As a developer, I want the orchestrator to store execution state in a queue file (`queue.json`), so that an interrupted run can resume where it left off without duplicating effort.
14. As a developer, I want the pipeline to run completely offline against local Ollama models on Apple Silicon Metal acceleration, so that my development workflow incurs zero API billing.
15. As a developer, I want the pipeline architecture to support future expansion to linter auto-fixes, static analysis remediation (e.g., SonarQube issues), and log-based bug reproduction once unit test generation is proven.

## Implementation Decisions

### 1. Repository & Physical Placement
- The orchestrator resides in its own isolated Git repository at `/Users/redguy/Documents/ai-pipeline`.
- Target projects are passed as runtime parameters (e.g., `--target /Users/redguy/TattooPop/tattoopop-api`).
- No orchestrator code or temporary state files will be committed to target application repositories.

### 2. Architectural Components
- **Discovery Engine (Scanner):** Traverses the target project's source tree (`src/modules/**`), detects missing `*.spec.ts` files, and applies domain filtering (prioritizing core business domains).
- **Queue Manager:** Persists task state in `.ai-pipeline/queue.json` supporting statuses: `pending`, `in_progress`, `completed`, `failed`.
- **Headless Worker (Agent Runner):** Wraps Aider in non-interactive batch mode (`--yes`, `--no-auto-commits`), connected to local Ollama using `qwen2.5:14b` with an expanded context window of 8,192 tokens.
- **Quality Gate (Runner & Validator):** Executes Jest with an explicit configuration flag (`npx jest --config jest.config.json <spec_path>`) and parses execution status and coverage output.
- **Reporting Engine:** Aggregates run metrics (duration, attempts, status, test count) into Markdown reports stored in `/Users/redguy/Documents/ai-pipeline/reports/`.

### 3. Git & Branching Protocol
- The orchestrator checks out or creates a dedicated local thematic branch in the target repository (e.g., `feat/ai-unit-tests-api`).
- Successful test files are staged and committed individually with conventional commit messages: `test(<module>): add unit tests for <service>`.
- Failed attempts trigger a hard discard of the test file via `git checkout -- <test_file>` and unstage any changes.
- Remote Git operations (`git push`, automated PR opening) are disabled.

### 4. Guardrails & Safety Parameters
- **Production Immutability:** Pre-execution and post-execution checksum/git-diff verification ensuring that target service implementation files (`*.service.ts`) remain 100% unchanged. If modified, changes are reverted immediately.
- **Circuit Breaker:** Maximum retry count of 3 attempts per service.
- **Execution Timeout:** Per-task execution timeout of 4 minutes to prevent hung processes on the local Mac.
- **Assertion Standards:** Prompts explicitly forbid trivial assertions (e.g., `expect(true).toBe(true)` or `expect(service).toBeDefined()`) and mandate assertions on returned data payloads and spy verification (`expect(repo.method).toHaveBeenCalledWith(...)`).

## Testing Decisions

### What Makes a Good Unit Test
- **External Behavior Verification:** Tests must validate public method contracts, return values, and state transitions, avoiding assertions on private internal methods.
- **Comprehensive Scenarios:** Each method must contain both "Happy Path" (successful execution with valid inputs) and "Sad Path" (expected domain exceptions, validation failures, or not-found errors).
- **Mock Isolation:** External dependencies (database repositories, external HTTP services, message queues) must be fully mocked using NestJS `@nestjs/testing` modules. No actual database connections or network sockets may be opened during unit test execution.
- **Determinism:** Tests must be idempotent, fast, and completely independent of system clock or random state.

### Prior Art & Baseline Alignment
- Existing tests in `tattoopop-api` (`src/app.controller.spec.ts` and `test/modules/**/*.spec.ts`) require a baseline configuration fix before agent execution. Specifically, Jest configuration duplication between `package.json` and `jest.config.json` will be resolved, and a single reference spec will be verified 100% green to serve as the golden template.

## Out of Scope

- Modifying application source code or fixing pre-existing business bugs discovered during test generation (these will be logged in the report for human review).
- Automated End-to-End (E2E) testing involving database fixtures or container orchestration (Docker/Testcontainers).
- Automated pushing to remote GitHub remotes or automated merging of branches.
- Real-time interactive UI/web dashboard (a terminal CLI with Markdown reporting is used).

## Further Notes

- **Multi-Platform Evolution Path:** After validating the NestJS pilot, platform plugins for Flutter (`flutter test`) and Svelte/Vite (`vitest`) will be introduced by implementing framework-specific scanners and test execution runners within the same core architecture.
- **Log-Driven Task Generation:** A future ingestion module will read structured JSON logs from staging/production to automatically synthesize regression test scenarios for reported 500 status codes.
