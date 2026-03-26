---
phase: 03-execution-engine
plan: 03
subsystem: core
tags: [pipeline-loop, fix-loop, while-loop, progressive-fix, crash-recovery, stage-outcome]

requires:
  - phase: 03-execution-engine/01
    provides: StageOutcome discriminated union, circuit breaker, shutdown coordinator
  - phase: 03-execution-engine/02
    provides: StageExecutor single-stage execution returning StageOutcome
  - phase: 02-foundation-layer
    provides: ArtifactStore, RunContext, EventBus instance

provides:
  - FixLoopRunner with progressive Tester-Coder fix strategy (direct-fix, replan, full-history)
  - PipelineLoop iterative while-loop stage orchestration with StageOutcome interpretation
  - Crash-safe state persistence after every outcome
  - Abort signal checking before each stage

affects: [03-execution-engine-integration, orchestrator-rewrite]

tech-stack:
  added: []
  patterns: [while-loop-with-outcome-switch, progressive-fix-strategy, delegated-fix-loop]

key-files:
  created:
    - src/core/fix-loop-runner.ts
    - src/core/pipeline-loop.ts
    - src/core/__tests__/fix-loop-runner.test.ts
    - src/core/__tests__/pipeline-loop.test.ts
  modified:
    - src/core/retry-log.ts

key-decisions:
  - "FixLoopRunner reads quality_assessment.verdict from manifest, not top-level verdict"
  - "PipelineLoop uses index i but never manipulates it for fix loop -- delegates entirely to FixLoopRunner"
  - "Added fix-loop-runner and stage-executor to RetryLogEntry source union type"

patterns-established:
  - "Delegated fix loop: PipelineLoop delegates fix loop to FixLoopRunner, no index manipulation"
  - "Outcome-driven loop: while loop with switch on StageOutcome.type for all 6 variants"
  - "Crash-safe state: savePipelineState called after every outcome including fix loop rounds"

requirements-completed: [EXEC-01, EXEC-02, EXEC-03]

duration: 13min
completed: 2026-03-27
---

# Phase 03 Plan 03: FixLoopRunner + PipelineLoop Summary

**Iterative while-loop pipeline orchestration with progressive Tester-Coder fix strategy replacing recursive executeStage() and duplicated fix loop code**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-26T20:43:38Z
- **Completed:** 2026-03-26T20:56:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- FixLoopRunner encapsulates progressive fix strategy (direct-fix rounds 1-2, replan round 3, full-history rounds 4-5) independently of pipeline index
- PipelineLoop uses iterative while loop with StageOutcome switch, replacing all recursive executeStage() calls
- Abort signal checked before each stage execution for graceful shutdown
- State persisted after every outcome (done, skipped, retry, rejected, fix_loop, failed) for crash recovery
- 26 tests total (12 FixLoopRunner + 14 PipelineLoop) covering all outcome types and edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: FixLoopRunner with progressive strategy** - `01fa908` (feat)
2. **Task 2: PipelineLoop with iterative while loop** - `93a6f10` (feat)

_Note: TDD tasks -- RED/GREEN phases combined per commit since module creation_

## Files Created/Modified
- `src/core/fix-loop-runner.ts` - Progressive Tester-Coder fix loop (130 lines), exports FixLoopRunner class and FixLoopConfig interface
- `src/core/pipeline-loop.ts` - Iterative while-loop pipeline orchestration (114 lines), exports PipelineLoop class and PipelineLoopCallbacks interface
- `src/core/__tests__/fix-loop-runner.test.ts` - 12 test cases covering progressive strategy, crash recovery, resume
- `src/core/__tests__/pipeline-loop.test.ts` - 14 test cases covering all 6 StageOutcome types, abort, fix loop delegation
- `src/core/retry-log.ts` - Added 'fix-loop-runner' and 'stage-executor' to RetryLogEntry source union type

## Decisions Made
- FixLoopRunner checks `quality_assessment.verdict` (nested path) matching the manifest schema used by TesterAgent
- PipelineLoop uses while loop with index `i` but never manipulates it for fix loop delegation -- FixLoopRunner is invoked as a black box
- Added both 'fix-loop-runner' and 'stage-executor' to RetryLogEntry source type since both were missing in this worktree

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copied Plan 01/02 dependency files to worktree**
- **Found during:** Task 1 (FixLoopRunner test setup)
- **Issue:** Worktree branch was missing files created by Plan 01 and Plan 02 (artifact-store.ts, run-context.ts, stage-outcome.ts, stage-executor.ts, test-helpers.ts) since those plans executed in parallel on different worktrees
- **Fix:** Copied dependency files from main repo to worktree
- **Files added:** src/core/artifact-store.ts, src/core/run-context.ts, src/core/stage-outcome.ts, src/core/stage-executor.ts, src/__tests__/test-helpers.ts
- **Verification:** Tests import and run successfully
- **Committed in:** 01fa908 (Task 1 commit)

**2. [Rule 3 - Blocking] Added missing source types to RetryLogEntry**
- **Found during:** Task 1 (FixLoopRunner implementation)
- **Issue:** RetryLogEntry.source union type did not include 'fix-loop-runner' or 'stage-executor', causing type errors
- **Fix:** Added both source types to the union in retry-log.ts
- **Files modified:** src/core/retry-log.ts
- **Committed in:** 01fa908 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for compilation and test execution. No scope creep.

## Issues Encountered
- Full test suite hangs on pre-existing orchestrator-integration.test.ts (times out waiting for interactive user input) -- unrelated to this plan's changes

## User Setup Required

None - no external service configuration required.

## Known Stubs

None -- all implementations are complete with no placeholder data.

## Next Phase Readiness
- FixLoopRunner and PipelineLoop are ready for integration into Orchestrator refactor
- Both modules are independently testable and can be wired into the Orchestrator without changing their interfaces
- Event sequence contract (pipeline:start -> stages -> pipeline:complete) captured as test fixture

---
*Phase: 03-execution-engine*
*Completed: 2026-03-27*
