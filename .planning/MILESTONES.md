# Milestones

## v1.0 Core Engine Rewrite (Shipped: 2026-03-28)

**Phases completed:** 7 phases, 19 plans, 35 tasks

**Key accomplishments:**

- Typed mock factories in test-helpers.ts and zero as-any casts across 8 test files for compile-time interface drift detection
- 5 integration tests for resume flow covering basic resume, --from reset with artifact cleanup, no-unexpected-deletion, state round-trip, and cascade-reset on missing manifests
- Full 13-stage canary E2E test with CanaryStubProvider and stub agents, plus v8 coverage measurement with 15% baseline threshold
- Result<T,E> discriminated union, ArtifactStore with per-run isolation, RunContext interface, and freezeConfig deep-freeze utility
- BaseAgent and all 10 agents migrated from (stage, provider, logger) to (stage, ctx: RunContext) with ArtifactStore-based artifact I/O and instance-scoped EventBus
- Replaced all silent catch blocks in evolution/engine.ts (10) and validator.ts (7) with typed error handling; fixed SecurityAuditor .env content exposure (SEC-01)
- Orchestrator creates RunContext with frozen config, passes it through entire call chain; zero artifact.ts globals, zero eventBus singleton imports in production code
- StageOutcome discriminated union, RetryingProvider with circuit breaker (5-failure threshold, 30s lazy recovery), and ShutdownCoordinator with SIGINT/SIGTERM graceful shutdown
- Single-stage executor returning StageOutcome discriminated union with duck-typed provider context and TDD-driven test coverage
- Iterative while-loop pipeline orchestration with progressive Tester-Coder fix strategy replacing recursive executeStage() and duplicated fix loop code
- CoderPlanner and CoderBuilder extracted from 1308-line coder.ts into standalone DI-based sub-modules with CoderDeps pattern and 12 passing tests
- BuildVerifier and SmokeRunner extracted from 1312-line coder.ts with 15 mocked unit tests covering all 4 shell command paths (setup/build/verify/smoke-test)
- 1. [Rule 3 - Blocking] OutputGenerator extraction to stay under 250 lines
- Replaced 3 console.warn calls with process.stderr.write in infrastructure modules; strengthened EventBus singleton deprecation
- Replaced ~148 console.log/warn/error calls across 11 files with process.stdout.write/process.stderr.write, achieving zero-console in all non-test src/ files
- 1. [Rule 2 - Missing module] Created OrchestratorGitOps extraction
- Corrected FixLoopRunner.checkTesterFailed() to read top-level manifest.verdict and added stage:skipped to PipelineEvents interface
- Wire ShutdownCoordinator into CLI entry with abort signal propagation, and refactor OutputGenerator to use instance-scoped ArtifactIO instead of legacy globals
- Rewrote README.md (Chinese) and README.en.md (English) with v2-accurate architecture content: bounded retry + circuit breaker, PipelineLoop/StageExecutor/FixLoopRunner/ShutdownCoordinator in architecture diagram, terminal demo block, reorganized section order, technical tone

---
