---
phase: 08-agent-architecture-fixes
plan: 01
subsystem: agents
tags: [tool-use, base-class, researcher, web-search, agent-architecture]

requires: []
provides:
  - ToolUseAgent base class for tool-use mode agents
  - Researcher migration to ToolUseAgent with WebSearch/WebFetch support
affects: [08-02, 08-03]

tech-stack:
  added: []
  patterns: [ToolUseAgent for allowedTools-mode agents, parseManifest for free-text manifest extraction]

key-files:
  created:
    - src/agents/tool-use-agent.ts
    - src/agents/__tests__/tool-use-agent.test.ts
    - src/agents/__tests__/researcher.test.ts
  modified:
    - src/agents/researcher.ts
    - src/agents/index.ts
    - .claude/agents/mosaic/researcher.md

key-decisions:
  - "ToolUseAgent extends BaseAgent directly (not LLMAgent) — clean separation of tool-use vs structured-output modes"
  - "parseManifest() as protected hook — subclasses extract manifest from free text, base class handles write logic"

patterns-established:
  - "ToolUseAgent pattern: allowedTools without jsonSchema, free-text response, manifest via parseManifest() hook"
  - "Fenced JSON block extraction: regex match ```json ... ``` for manifest in tool-use agent responses"

requirements-completed: [AGENT-01, AGENT-02]

duration: 8min
completed: 2026-03-28
---

# Phase 08 Plan 01: ToolUseAgent + Researcher Migration Summary

**ToolUseAgent base class for tool-use mode (allowedTools, no jsonSchema) with Researcher as first consumer using WebSearch/WebFetch**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-28T09:54:38Z
- **Completed:** 2026-03-28T10:02:39Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created ToolUseAgent as sibling to LLMAgent, both extending BaseAgent
- Migrated Researcher from LLMAgent to ToolUseAgent with parseManifest() for JSON extraction
- Updated researcher.md prompt to use WebSearch/WebFetch tools instead of structured JSON output
- 9 unit tests passing (5 for ToolUseAgent, 4 for Researcher)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ToolUseAgent base class + tests** - `e3445d4` (test: RED), `c96b900` (feat: GREEN)
2. **Task 2: Migrate Researcher to ToolUseAgent + update prompt** - `405c021` (test: RED), `aa65ace` (feat: GREEN)

_TDD tasks each have RED (failing test) and GREEN (implementation) commits._

## Files Created/Modified
- `src/agents/tool-use-agent.ts` - ToolUseAgent base class with allowedTools mode
- `src/agents/__tests__/tool-use-agent.test.ts` - 5 unit tests for ToolUseAgent
- `src/agents/__tests__/researcher.test.ts` - 4 unit tests for ResearcherAgent
- `src/agents/researcher.ts` - Rewritten to extend ToolUseAgent with parseManifest()
- `src/agents/index.ts` - Added ToolUseAgent barrel export
- `.claude/agents/mosaic/researcher.md` - Updated output format for tool-use mode

## Decisions Made
- ToolUseAgent extends BaseAgent directly, not LLMAgent -- clean separation avoids jsonSchema leaking into tool-use mode
- parseManifest() returns `unknown | undefined` to let manifest schema validation happen at the writeManifest layer

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test manifest data to match Zod schema**
- **Found during:** Task 1 (ToolUseAgent tests)
- **Issue:** Test used `{ competitors: ['A', 'B'] }` which fails Zod validation -- missing required fields
- **Fix:** Updated test data to include all required fields (competitors, key_insights, feasibility, risks)
- **Files modified:** src/agents/__tests__/tool-use-agent.test.ts
- **Verification:** All 5 tests pass
- **Committed in:** c96b900 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test data fix. No scope creep.

## Issues Encountered
- Pre-existing type errors in run-manager.ts, coder.ts, etc. -- not caused by this plan, not fixed

## Known Stubs
None -- all code is fully wired.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ToolUseAgent pattern established for future tool-use agents (SecurityAuditor, Tester could potentially use this)
- Researcher ready for real web search via WebSearch/WebFetch tools from agents.yaml

## Self-Check: PASSED

All 6 files verified on disk. All 4 commits verified in git log.

---
*Phase: 08-agent-architecture-fixes*
*Completed: 2026-03-28*
