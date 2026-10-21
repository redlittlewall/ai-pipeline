# 🤖 Autonomous AI Testing Pipeline (`ai-pipeline`)

An autonomous, local, and zero-cost code quality and test generation orchestrator for software projects. Powered by local LLMs via [Ollama](https://ollama.com/) (Qwen 2.5 14B) and [Aider](https://aider.chat/) on Apple Silicon.

---

## ⚡ Core Principles & Guardrails

1. **Zero Cloud API Costs & Complete Privacy:** Runs 100% locally on your Mac using Ollama with Metal GPU acceleration.
2. **Anti-Cheat Guardrail (Production Immutability):** Production service files (`*.service.ts`) are strictly read-only. If the AI modifies the production service to make tests pass, changes are instantly reverted via Git.
3. **Quality Gate Verification:** No code is committed unless the native test runner (`jest`) executes and passes with 100% success.
4. **Circuit Breaker:** Maximum 3 attempts per service with automatic traceback error feedback. Failed attempts are cleanly discarded.
5. **Zero Remote Polluting:** Works strictly on a local Git branch (`feat/ai-unit-tests-api`) with zero automatic remote pushes.
6. **Detailed Markdown Reporting:** Generates human-readable execution reports in `reports/run_YYYYMMDD_HHMM.md`.

---

## 🚀 Quick Start

### 1. Requirements
- macOS with Apple Silicon (M-series)
- [Ollama](https://ollama.com/) running with `qwen2.5:14b` (`ollama run qwen2.5:14b`)
- Python 3.12+ and `aider` (`uv tool install --python 3.12 aider-chat`)

### 2. Scanning a Target Project
Scans for untested services (e.g. in `tattoopop-api`) and populates `queue.json`:
```bash
python3 main.py scan --target /Users/redguy/TattooPop/tattoopop-api --domain core
```

### 3. Checking Queue Status
```bash
python3 main.py status
```

### 4. Running the Autonomous Batch
Run all pending tasks (or test with `--limit 1`):
```bash
# Test single task first
python3 main.py run --limit 1

# Run full nightly batch
python3 main.py run
```

---

## 🧩 Multi-Framework Profile Support

The pipeline dynamically adapts to any target project framework using **Profiles** with auto-detection:
- **`nestjs`** (Auto-detected if `package.json` contains `@nestjs`): Uses Jest (`npx jest --config jest.config.json`), NestJS testing modules, TypeORM mocks, and `.spec.ts` files.
- **`flutter`** (Auto-detected if `pubspec.yaml` exists): Uses Flutter test (`flutter test`), `package:test` / `mocktail`, and `_test.dart` files.
- **`svelte`** (Auto-detected if `svelte.config.js` exists): Uses Vitest (`npx vitest run`), store/API mocks, and `.test.ts` files.

You can also explicitly pass `--profile [nestjs|flutter|svelte]` to override detection:
```bash
python3 main.py scan --target /path/to/project --profile nestjs
```

---

## 📊 Project Structure

```text
ai-pipeline/
├── main.py                 # Main CLI entrypoint
├── pipeline/
│   ├── profiles/           # Framework profiles (nestjs, flutter, svelte)
│   ├── queue_manager.py    # Queue persistence & state machine (queue.json)
│   ├── scanner.py          # Untested service discovery & domain filtering
│   ├── worker.py           # Single-task worker harness (Aider + Quality Gate + Anti-Cheat)
│   └── runner.py           # Batch orchestrator & Markdown report writer
├── templates/              # Framework-specific prompt templates
├── reports/                # Consolidated execution reports
└── tests/                  # Unit test suite for the pipeline itself
```
