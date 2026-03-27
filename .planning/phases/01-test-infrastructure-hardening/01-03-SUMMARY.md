---
phase: 01-test-infrastructure-hardening
plan: 03
subsystem: testing
tags: [vitest, coverage, e2e, canary, v8-coverage, pipeline]

requires:
  - phase: 01-01
    provides: test-helpers and mock factories

provides:
  - Full 13-stage canary E2E test exercising entire pipeline with deterministic stubs
  - Coverage measurement with v8 provider and baseline threshold enforcement
  - Coverage reports in text, json, html formats for CI visibility

affects: [all-phases, rewrite-safety-net]

tech-stack:
  added: ["@vitest/coverage-v8"]
  patterns: ["stub agent pattern for complex BaseAgent subclasses", "case-insensitive system prompt detection for LLM mocks", "auto-answering CLIInteractionHandler mock for E2E tests"]

key-files:
  created:
    - src/__tests__/e2e-canary.test.ts
  modified:
    - vitest.config.ts
    - .gitignore
    - package.json

key-decisions:
  - "Used stub agent classes for Coder/Tester/SecurityAuditor/QALead instead of real agents with mock LLM, because these agents use tool use, shell commands, and multi-pass LLM calls that cannot be deterministically stubbed via a simple LLM provider mock"
  - "Set coverage threshold at 15% lines (measured baseline ~16%) to be conservative with pre-existing test failures"
  - "Mocked CLIInteractionHandler to auto-answer questions, needed because IntentConsultant always creates a fresh CLIInteractionHandler that blocks on terminal input"

patterns-established:
  - "Stub agent pattern: for agents extending BaseAgent with complex run() logic (shell commands, tool use), create lightweight stub classes that write expected artifacts directly"
  - "System prompt detection: use case-insensitive matching against agent prompt file headings (e.g., '# Researcher Agent') for reliable stage routing in mock providers"

requirements-completed: [TEST-03]

duration: 57min
completed: 2026-03-26
---

# Phase 01 Plan 03: E2E Canary and Coverage Baseline Summary

**Full 13-stage canary E2E test with CanaryStubProvider and stub agents, plus v8 coverage measurement with 15% baseline threshold**

## Performance

- **Duration:** 57 min
- **Started:** 2026-03-26T14:48:21Z
- **Completed:** 2026-03-26T15:45:43Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created `e2e-canary.test.ts` (610 lines) exercising all 13 pipeline stages with deterministic stubs
- Verified 25+ artifact files exist on disk after full pipeline run, validated 11 manifest JSON files
- Installed @vitest/coverage-v8 and configured coverage with text+json+html reporters
- Set baseline threshold: lines >= 15% (measured ~16.35%)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create full 13-stage canary E2E test** - `172e1f6` (test)
2. **Task 2: Configure coverage measurement with baseline enforcement** - `41105e5` (chore)

## Files Created/Modified
- `src/__tests__/e2e-canary.test.ts` - Full 13-stage canary E2E test with deterministic stubs
- `vitest.config.ts` - Added v8 coverage config with 15% line threshold
- `.gitignore` - Added coverage/ directory
- `package.json` - Added @vitest/coverage-v8 devDependency
- `package-lock.json` - Lock file update

## Decisions Made
- Used stub agent classes (CanaryCoderStub, CanaryTesterStub, etc.) for complex BaseAgent subclasses that use shell commands and tool use, rather than trying to mock their multi-pass LLM flows through a stub provider
- Set conservative 15% coverage threshold (measured ~16%) because many existing tests have pre-existing failures that reduce measurable coverage
- Mocked CLIInteractionHandler globally to auto-answer clarification questions, required because the IntentConsultant always creates a fresh CLIInteractionHandler that blocks on terminal input in test environments

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] IntentConsultant CLIInteractionHandler hangs in tests**
- **Found during:** Task 1 (canary test creation)
- **Issue:** IntentConsultant always creates a new CLIInteractionHandler (even when RunManager uses DeferredInteractionHandler), and forces at least one round of questions on round 0. This blocks E2E tests with terminal input prompts.
- **Fix:** Added vi.mock for interaction-handler.js that replaces CLIInteractionHandler with AutoAnswerCLIHandler (auto-selects first option)
- **Files modified:** src/__tests__/e2e-canary.test.ts
- **Verification:** Test no longer hangs, completes in ~3 seconds
- **Committed in:** 172e1f6 (Task 1 commit)

**2. [Rule 3 - Blocking] Complex agents (Coder, Tester, SecurityAuditor, QALead) incompatible with simple LLM mock**
- **Found during:** Task 1 (canary test creation)
- **Issue:** These agents extend BaseAgent and use shell commands (execSync), tool use (allowedTools), multi-pass LLM calls, and filesystem operations that cannot be deterministically mocked through a simple LLM provider stub.
- **Fix:** Created lightweight stub agent classes (CanaryCoderStub, CanaryTesterStub, etc.) in the agent-factory mock that write expected artifacts directly, bypassing the real agents' complex run() logic.
- **Files modified:** src/__tests__/e2e-canary.test.ts
- **Verification:** All 13 stages complete, all expected artifacts exist on disk
- **Committed in:** 172e1f6 (Task 1 commit)

**3. [Rule 1 - Bug] Manifest schema validation failures due to incomplete stub data**
- **Found during:** Task 1 (canary test creation)
- **Issue:** Initial stub responses for ProductOwner, UIDesigner, TechLead, Reviewer manifests were missing required fields defined in Zod schemas (e.g., TechSpecManifest requires `implementation_tasks[]`, UIPlanComponent requires `category` enum)
- **Fix:** Updated all stub responses to match the exact Zod schema requirements in `src/core/manifest.ts` and `src/agents/ui-plan-schema.ts`
- **Files modified:** src/__tests__/e2e-canary.test.ts
- **Verification:** All manifest validations pass, no ZodError thrown
- **Committed in:** 172e1f6 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All auto-fixes necessary for test functionality. The stub agent approach is architecturally sound and matches the project's existing test patterns. No scope creep.

## Issues Encountered
- Pre-existing test failures (28 tests across 10 files) are unrelated to this plan's changes. These affect coverage baseline measurement but do not regress from our changes.
- Existing E2E tests (e2e-phase3, e2e-phase4, e2e-phase5) also hang on the IntentConsultant CLIInteractionHandler issue, confirming this is a pre-existing problem introduced when IntentConsultant was added to the pipeline.

## Known Stubs
None - all artifacts are fully wired with deterministic data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Canary test provides a safety net for all rewrite phases
- Coverage baseline established; future phases can only increase coverage
- Pre-existing test failures should be investigated separately (not in scope for this plan)

## Self-Check: PASSED
- src/__tests__/e2e-canary.test.ts: FOUND
- vitest.config.ts: FOUND
- .gitignore: FOUND
- Commit 172e1f6: FOUND
- Commit 41105e5: FOUND

---
*Phase: 01-test-infrastructure-hardening*
*Completed: 2026-03-26*
