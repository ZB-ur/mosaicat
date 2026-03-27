---
phase: 04-coder-decomposition
plan: 02
subsystem: agents
tags: [coder, build-verifier, smoke-runner, child_process, tdd, shell-commands]

requires:
  - phase: 04-01
    provides: CoderDeps, BuildVerifierDeps, SmokeRunnerDeps interfaces and utils
provides:
  - BuildVerifier class with shell command execution and build-fix loops
  - SmokeRunner class with HTTP probe and port waiting
  - Unit tests covering all 4 shell command paths (setup/build/verify/smoke-test)
affects: [04-03]

tech-stack:
  added: []
  patterns: [dependency-injection via typed deps interfaces, TDD red-green for extraction]

key-files:
  created:
    - src/agents/coder/build-verifier.ts
    - src/agents/coder/smoke-runner.ts
    - src/agents/__tests__/build-verifier.test.ts
    - src/agents/__tests__/smoke-runner.test.ts
  modified: []

key-decisions:
  - "extractErrorFiles returns relative paths (no codeDir prefix) for BuildVerifier, unlike original coder.ts"
  - "SmokeRunner accepts optional timeoutOverrideMs parameter for testability"

patterns-established:
  - "Shell command wrappers return {success, errors} result objects instead of throwing"
  - "SmokeRunner skips non-web/api types rather than failing"

requirements-completed: [CODER-03, CODER-04, TEST-04]

duration: 4min
completed: 2026-03-27
---

# Phase 04 Plan 02: BuildVerifier and SmokeRunner Extraction Summary

**BuildVerifier and SmokeRunner extracted from 1312-line coder.ts with 15 mocked unit tests covering all 4 shell command paths (setup/build/verify/smoke-test)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-26T21:27:52Z
- **Completed:** 2026-03-26T21:32:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- BuildVerifier class encapsulating setup/verify/build commands, error extraction, build-fix loops, acceptance tests, and user confirmation
- SmokeRunner class with HTTP probe, TCP port waiting, process lifecycle management, and readyPattern support
- 15 unit tests with mocked child_process covering all 4 shell command execution paths required by TEST-04

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BuildVerifier sub-module with shell command path tests** - `789a049` (feat)
2. **Task 2: Create SmokeRunner sub-module with shell command path tests** - `4d80ae5` (feat)

_TDD red-green cycle used for both tasks_

## Files Created/Modified
- `src/agents/coder/build-verifier.ts` - BuildVerifier class with setup/verify/build commands, build-fix loops, acceptance tests, user confirmation
- `src/agents/coder/smoke-runner.ts` - SmokeRunner class with HTTP probe, port waiting, process cleanup
- `src/agents/__tests__/build-verifier.test.ts` - 9 unit tests for BuildVerifier shell command paths
- `src/agents/__tests__/smoke-runner.test.ts` - 6 unit tests for SmokeRunner smoke-test path

## Decisions Made
- extractErrorFiles in BuildVerifier returns relative paths without codeDir prefix (cleaner API, codeDir is internal)
- SmokeRunner.runSmokeTest accepts optional timeoutOverrideMs for fast test execution (avoids 15s waits in tests)
- SmokeRunner supports both 'web' and 'api' types (original only checked 'web', but 'api' is a valid smokeTest type)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added timeoutOverrideMs parameter to SmokeRunner.runSmokeTest**
- **Found during:** Task 2 (SmokeRunner tests)
- **Issue:** Default 15s timeout would make tests slow; no way to override
- **Fix:** Added optional timeoutOverrideMs parameter to runSmokeTest method
- **Files modified:** src/agents/coder/smoke-runner.ts
- **Verification:** Tests run in ~500ms instead of 15s

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Minor API addition for testability. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BuildVerifier and SmokeRunner ready for Plan 03 (CoderAgent facade rewiring)
- All 4 sub-modules now extracted: CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner
- Pre-existing type errors in fix-loop-runner.test.ts are unrelated to this plan

## Self-Check: PASSED

All 4 created files verified on disk. Both commit hashes (789a049, 4d80ae5) verified in git log.

---
*Phase: 04-coder-decomposition*
*Completed: 2026-03-27*
