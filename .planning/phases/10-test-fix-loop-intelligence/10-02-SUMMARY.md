---
phase: 10-test-fix-loop-intelligence
plan: 02
subsystem: testing
tags: [vitest, fix-loop, stagnation-detection, failure-classification, event-bus]

requires:
  - phase: 10-01
    provides: "failure-classifier.ts with classifyTestOutput, createFingerprint, fingerprintsMatch, getDominantCategory"
provides:
  - "FixStrategy interface with approach + direction dimensions"
  - "Stagnation detection in FixLoopRunner (2 consecutive identical rounds -> early termination)"
  - "stagnation-report.md artifact with classified failures and suggested fix directions"
  - "Classification-driven test-failures-for-coder.md with Fix Focus sections"
  - "errorCategory visibility in event-bus, cli-progress, retry-log"
affects: [orchestrator-fix-loop, coder-agent-fix-context]

tech-stack:
  added: []
  patterns: [two-dimension fix strategy (round + classification), post-execution fingerprint comparison for stagnation]

key-files:
  created: []
  modified:
    - src/core/fix-loop-runner.ts
    - src/core/__tests__/fix-loop-runner.test.ts
    - src/core/event-bus.ts
    - src/core/cli-progress.ts
    - src/core/retry-log.ts

key-decisions:
  - "Post-execution fingerprint comparison: stagnation checked after each round completes, not before"
  - "Empty classified failures skip stagnation check: prevents false positive when test-report.md is absent"

patterns-established:
  - "Two-dimension FixStrategy: round-based escalation (direct-fix/replan/full-history) + classification-based direction (config-dependency/logic/environment)"
  - "Post-round stagnation check: compare failure fingerprint after coder+tester execution, not before"

requirements-completed: [TEST-03, TEST-04]

duration: 6min
completed: 2026-03-29
---

# Phase 10 Plan 02: Stagnation Detection & Classification-Driven Fix Strategy Summary

**FixLoopRunner with 2-consecutive-round stagnation detection, classification-driven fix direction (config-dependency/logic/environment), and 4-channel error visibility (logs, test-report injection, CLI progress, retry-log)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-28T17:30:32Z
- **Completed:** 2026-03-28T17:36:36Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- FixLoopRunner detects stagnation after 2 identical failure fingerprints and terminates early with stagnation-report.md
- selectApproach returns FixStrategy with both round-based approach and classification-based direction
- test-failures-for-coder.md includes Test Failure Analysis header with dominant error type and Fix Focus section
- Error classification visible in all 4 channels: pipeline logs, test-report injection, CLI progress events, retry-log
- 20 test cases (12 original + 8 new) all passing via TDD

## Task Commits

Each task was committed atomically:

1. **Task 1: Stagnation detection + classification-driven strategy (TDD)** - `b26db48` (feat)
2. **Task 2: Wire classification visibility through event-bus and cli-progress** - `81fba7c` (feat)

## Files Created/Modified
- `src/core/fix-loop-runner.ts` - Added FixStrategy interface, DIRECTION_MAP, stagnation detection (checkStagnation, writeStagnationReport), classification-driven selectApproach, enriched injectTestFailuresForCoder
- `src/core/__tests__/fix-loop-runner.test.ts` - 8 new tests: stagnation termination, stagnation-report.md content, fix direction mapping, errorCategory emission, classification context in coder file
- `src/core/event-bus.ts` - Extended coder:fix-round signature with optional errorCategory parameter
- `src/core/cli-progress.ts` - Display errorCategory as [category] suffix in fix round output
- `src/core/retry-log.ts` - Added parse-import and assertion to ErrorCategory union type

## Decisions Made
- Post-execution fingerprint comparison: stagnation is checked after each coder+tester round completes, comparing post-fix results. This ensures we detect "the fix didn't help" rather than "the pre-fix state matches"
- Empty classified failures skip stagnation: when test-report.md doesn't exist (no FAIL blocks parseable), stagnation check is bypassed to prevent false positives on tests that only have verdict without detailed output

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved stagnation check to post-execution position**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Plan placed stagnation check before round execution, causing false stagnation on first round (initial test-report.md matched itself)
- **Fix:** Restructured run() to check stagnation after executor.execute() calls, comparing post-fix fingerprints
- **Files modified:** src/core/fix-loop-runner.ts
- **Verification:** All 20 tests pass including stagnation tests
- **Committed in:** b26db48

**2. [Rule 1 - Bug] Fixed vi.fn() typing for Vitest 4**
- **Found during:** Task 2
- **Issue:** `vi.fn()` without type param produces Mock<Procedure | Constructable> not assignable to typed callback
- **Fix:** Changed to `vi.fn<(fixLoopRound: number) => void>()` with explicit type
- **Files modified:** src/core/__tests__/fix-loop-runner.test.ts
- **Verification:** tsc --noEmit passes for test file
- **Committed in:** 81fba7c

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- Pre-existing type errors in run-manager.ts (TS2454) and stage-executor.ts (cherry-picked without full dependency context) -- not introduced by this plan, out of scope

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FixLoopRunner stagnation detection and classification-driven strategy fully operational
- All 4 visibility channels wired and testable
- Orchestrator can consume FixStrategy.direction for enhanced logging
- stagnation-report.md artifact available for post-run analysis

---
*Phase: 10-test-fix-loop-intelligence*
*Completed: 2026-03-29*
