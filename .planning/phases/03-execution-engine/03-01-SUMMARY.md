---
phase: 03-execution-engine
plan: 01
subsystem: core
tags: [circuit-breaker, retry, shutdown, abort-signal, discriminated-union]

requires:
  - phase: 02-foundation-layer
    provides: RunContext with AbortSignal, ArtifactStore, LLMProvider interface
provides:
  - StageOutcome discriminated union (6 variants) for typed stage results
  - CircuitOpenError for circuit breaker state
  - RetryingProvider with bounded max retries (20) and circuit breaker
  - ShutdownCoordinator for graceful SIGINT/SIGTERM handling
affects: [03-execution-engine, 05-orchestrator-facade]

tech-stack:
  added: []
  patterns: [circuit-breaker-lazy-recovery, abort-controller-shutdown, discriminated-union-stage-outcome]

key-files:
  created:
    - src/core/stage-outcome.ts
    - src/core/shutdown-coordinator.ts
    - src/core/__tests__/retrying-provider.test.ts
    - src/core/__tests__/shutdown-coordinator.test.ts
  modified:
    - src/core/retrying-provider.ts

key-decisions:
  - "Lazy circuit breaker recovery via Date.now() check instead of setTimeout -- no timer leak"
  - "HALF_OPEN failure immediately reopens circuit (single-probe pattern)"
  - "Injectable forceExit in ShutdownCoordinator for testability"

patterns-established:
  - "Circuit breaker: lazy time-based HALF_OPEN recovery without timers"
  - "Shutdown: AbortController signal as communication channel to pipeline loop"

requirements-completed: [EXEC-04, EXEC-05]

duration: 5min
completed: 2026-03-26
---

# Phase 3 Plan 1: Execution Engine Foundations Summary

**StageOutcome discriminated union, RetryingProvider with circuit breaker (5-failure threshold, 30s lazy recovery), and ShutdownCoordinator with SIGINT/SIGTERM graceful shutdown**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-26T20:27:53Z
- **Completed:** 2026-03-26T20:33:18Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created StageOutcome discriminated union with 6 variants (done, skipped, retry, rejected, failed, fix_loop) and CircuitOpenError class
- Enhanced RetryingProvider with bounded max retries (20 default, was Infinity) and circuit breaker (5 consecutive failures opens, lazy HALF_OPEN recovery after 30s)
- Created ShutdownCoordinator with AbortController-based signal, idempotent install/uninstall, cleanup promise waiting, and double-SIGINT force exit

## Task Commits

Each task was committed atomically:

1. **Task 1: StageOutcome type + RetryingProvider max retries + circuit breaker** - `0914fd5` (feat)
2. **Task 2: ShutdownCoordinator with SIGINT/SIGTERM handling** - `9493f2c` (feat)

_Both tasks used TDD: tests written first (RED), implementation added (GREEN)._

## Files Created/Modified
- `src/core/stage-outcome.ts` - StageOutcome discriminated union (6 variants) + CircuitOpenError class
- `src/core/retrying-provider.ts` - Enhanced with CircuitBreakerConfig, max retries (20), circuit breaker state machine
- `src/core/shutdown-coordinator.ts` - Graceful shutdown with SIGINT/SIGTERM, AbortController signal, cleanup waiting
- `src/core/__tests__/retrying-provider.test.ts` - 12 tests: max retries, circuit breaker states, lazy recovery
- `src/core/__tests__/shutdown-coordinator.test.ts` - 8 tests: signal state, cleanup, double-signal, idempotency

## Decisions Made
- Lazy circuit breaker recovery via `Date.now() - openedAt >= recoveryMs` instead of setTimeout -- no timer leak, no unref() needed
- HALF_OPEN failure immediately reopens circuit (single-probe pattern) rather than requiring failureThreshold consecutive failures again
- Injectable forceExit callback in ShutdownCoordinator for test isolation (default: process.exit(1))
- Disabled circuit breaker in max-retry tests by setting high failureThreshold to isolate concerns

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unhandled promise rejections in circuit breaker tests**
- **Found during:** Task 1 (RetryingProvider tests)
- **Issue:** Timer-based tests with fake timers caused unhandled rejections when circuit breaker opened mid-retry-loop. Promises rejected asynchronously between timer advances.
- **Fix:** Added `.catch(() => undefined)` guards on expected-to-reject promises before advancing timers, then awaited the guarded promise before asserting on the original.
- **Files modified:** src/core/__tests__/retrying-provider.test.ts
- **Verification:** All 12 tests pass with 0 unhandled rejections
- **Committed in:** 0914fd5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test hygiene fix, no scope creep.

## Issues Encountered
None beyond the test fix documented above.

## Next Phase Readiness
- StageOutcome, RetryingProvider (circuit breaker), and ShutdownCoordinator are leaf modules ready for StageExecutor and PipelineLoop (Plans 02 and 03)
- CircuitOpenError is not yet handled by orchestrator -- will be addressed in Phase 5 (orchestrator facade)
- ShutdownCoordinator.signal is the bridge to RunContext.signal for pipeline loop abort checking

## Self-Check: PASSED

- All 5 files exist on disk
- Both commits verified (0914fd5, 9493f2c)
- All acceptance criteria met (exports, imports, methods, line counts)
- 20 tests passing (12 retrying-provider + 8 shutdown-coordinator)
- TypeScript compilation clean (tsc --noEmit exits 0)

---
*Phase: 03-execution-engine*
*Completed: 2026-03-26*
