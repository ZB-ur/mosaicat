# Roadmap: Mosaicat v2 Core Engine Rewrite

## Overview

A bottom-up strangler fig rewrite of the Mosaicat pipeline engine. We harden the test suite first (so we can trust our safety net), then replace leaf modules (ArtifactStore, error handling), build the new execution engine (iterative loop, stage executor), decompose the Coder monolith, and finally collapse the Orchestrator into a thin facade. Each phase leaves the system runnable. The orchestrator -- the hub of all dependencies -- is rewritten last, after everything it delegates to is stable.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Test Infrastructure Hardening** - Make the test suite trustworthy before rewriting anything
- [ ] **Phase 2: Foundation Layer** - ArtifactStore instance scoping, Result type, silent catch elimination, config freeze
- [ ] **Phase 3: Execution Engine** - Iterative pipeline loop, StageExecutor, FixLoopRunner, graceful shutdown
- [ ] **Phase 4: Coder Decomposition** - Split 1312-line monolith into 4 focused sub-modules + facade
- [ ] **Phase 5: Orchestrator Facade + Logging Cleanup** - Thin orchestrator wiring, unified logging, EventBus instance scoping

## Phase Details

### Phase 1: Test Infrastructure Hardening
**Goal**: The test suite is trustworthy enough to serve as a safety net for the rewrite -- typed mocks replace unsafe casts, and critical paths (resume, integration) have real coverage
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Zero `as any` type casts remain in test files -- all mocks use typed factory functions (`createTestContext()`, `createMockProvider()`)
  2. Resume flow has integration tests that exercise `resumeRun()`, `--from` stage reset, and artifact cleanup against real modules (not mocks)
  3. A canary integration test runs a full pipeline (all real modules except LLM, which uses a deterministic stub) and verifies artifacts land on disk
**Plans:** 3 plans
Plans:
- [x] 01-01-PLAN.md — Typed mock factories + eliminate all `as any` casts from test files
- [x] 01-02-PLAN.md — Resume flow integration tests (5 scenarios)
- [ ] 01-03-PLAN.md — Full 13-stage canary E2E test + coverage baseline

### Phase 2: Foundation Layer
**Goal**: The core building blocks for the rewrite exist and are proven -- artifact I/O is instance-scoped, errors are explicit, config is immutable, and a RunContext bundles everything per run
**Depends on**: Phase 1
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, STATE-01, STATE-02, STATE-03, STATE-04, SEC-01
**Success Criteria** (what must be TRUE):
  1. `ArtifactStore` is instantiated per run and all artifact reads/writes go through it -- preserved modules (BaseAgent) continue working via the bridge pattern without modification
  2. All 16 silent catch blocks (9 in Evolution Engine, 7 in Validator) are replaced with `logger.warn()` + typed fallback -- damaged manifests return an explicit "unreadable" status instead of silent empty results
  3. Context Manager fails fast (throws) when a prompt file is missing in production mode, and logs a warning in development mode
  4. Config is frozen via `structuredClone` + `Object.freeze` before pipeline execution -- any mutation attempt throws at runtime
  5. `RunContext` object exists and bundles ArtifactStore, Logger, Provider, EventBus, Config, and AbortSignal for a single run
**Plans**: TBD

### Phase 3: Execution Engine
**Goal**: The pipeline executes via an iterative loop with explicit stage outcomes, finite retries, circuit breakers, and clean shutdown -- no recursion, no infinite retries, no orphaned state on SIGINT
**Depends on**: Phase 2
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05
**Success Criteria** (what must be TRUE):
  1. Pipeline stages execute via a `while` loop with `StageOutcome` discriminated union returns -- recursive `executeStage()` is no longer called
  2. Tester-Coder fix loop runs as an independent `FixLoopRunner` with progressive strategy (direct-fix, replan, full-history) -- no index manipulation in the main pipeline loop
  3. `RetryingProvider` enforces a maximum of 20 retries and a circuit breaker that opens after 5 consecutive failures (30s half-open recovery)
  4. SIGINT/SIGTERM triggers `ShutdownCoordinator` which completes the current stage's artifact write before exiting -- no partial artifacts on disk
  5. `StageExecutor` handles single-stage execution including retry, gate checking, and context building as a standalone unit testable in isolation
**Plans:** 3 plans
Plans:
- [ ] 03-01-PLAN.md — StageOutcome type + RetryingProvider circuit breaker + ShutdownCoordinator
- [ ] 03-02-PLAN.md — StageExecutor single-stage execution unit
- [ ] 03-03-PLAN.md — FixLoopRunner + PipelineLoop iterative orchestration

### Phase 4: Coder Decomposition
**Goal**: The 1312-line Coder monolith is replaced by 4 focused sub-modules and a thin facade, each independently testable with clear single responsibilities
**Depends on**: Phase 2
**Requirements**: CODER-01, CODER-02, CODER-03, CODER-04, CODER-05, TEST-04
**Success Criteria** (what must be TRUE):
  1. `CoderPlanner` generates `code-plan.json` as a standalone module with its own unit tests
  2. `CoderBuilder` handles skeleton generation and module implementation as a standalone module
  3. `BuildVerifier` runs compilation checks and build-fix loops independently -- its retry behavior is testable without the full Coder
  4. `SmokeRunner` performs HTTP probes and smoke tests as a standalone module with shell command execution path tests
  5. `coder.ts` is a thin facade (under 250 lines) that delegates to the 4 sub-modules -- all existing Coder behavior is preserved
**Plans**: TBD

### Phase 5: Orchestrator Facade + Logging Cleanup
**Goal**: The Orchestrator is a thin wiring layer that creates RunContext and delegates to PipelineLoop -- all console output goes through Logger, EventBus is instance-scoped
**Depends on**: Phase 3
**Requirements**: ORCH-01, ORCH-02, ORCH-03
**Success Criteria** (what must be TRUE):
  1. Orchestrator is under 200 lines and its only job is creating RunContext and delegating to PipelineLoop -- no stage execution logic lives in the Orchestrator
  2. Zero `console.log` / `console.warn` / `console.error` calls remain in `src/` (excluding test files) -- all output routes through the Logger module
  3. EventBus is instantiated per run (not a singleton) and passed via RunContext -- concurrent runs (future) would not share events
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5
Note: Phase 4 depends on Phase 2 (not Phase 3), so it could theoretically overlap with Phase 3. However, sequential execution is the default.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Infrastructure Hardening | 0/3 | Planning complete | - |
| 2. Foundation Layer | 0/TBD | Not started | - |
| 3. Execution Engine | 0/3 | Planning complete | - |
| 4. Coder Decomposition | 0/TBD | Not started | - |
| 5. Orchestrator Facade + Logging Cleanup | 0/TBD | Not started | - |
