---
phase: 02-foundation-layer
plan: 02
subsystem: core
tags: [runcontext, dependency-injection, artifact-store, event-bus, agent-migration]

requires:
  - phase: 02-foundation-layer/01
    provides: RunContext interface, ArtifactStore class, Result type, freezeConfig

provides:
  - BaseAgent with RunContext-based constructor (stage, ctx)
  - All 10 agent implementations migrated to RunContext
  - agent-factory accepting RunContext
  - manifest.ts with ArtifactStore-based API (plus legacy overloads)
  - context-manager with Tier 1/2 error handling
  - createTestRunContext() and createTestArtifactStore() test utilities

affects: [02-foundation-layer/03, 02-foundation-layer/04, orchestrator-migration]

tech-stack:
  added: []
  patterns:
    - "RunContext dependency injection for agent layer"
    - "Bridge pattern for backward-compatible orchestrator calls"
    - "Function overloads for gradual manifest.ts migration"
    - "Tier 1 (throw) / Tier 2 (warn) error handling in context-manager"

key-files:
  created: []
  modified:
    - src/core/agent.ts
    - src/core/agent-factory.ts
    - src/core/manifest.ts
    - src/core/event-bus.ts
    - src/core/context-manager.ts
    - src/agents/llm-agent.ts
    - src/agents/coder.ts
    - src/agents/intent-consultant.ts
    - src/agents/refine-agent.ts
    - src/agents/qa-lead.ts
    - src/agents/tester.ts
    - src/agents/ui-designer.ts
    - src/agents/security-auditor.ts
    - src/agents/validator.ts
    - src/__tests__/test-helpers.ts

key-decisions:
  - "Kept eventBus singleton with @deprecated tag for non-agent callers (orchestrator, cli-progress) -- will be removed in Plan 04"
  - "Used function overloads in manifest.ts for backward compat with legacy (name-only) and new (store, name) APIs"
  - "Created bridge RunContext in orchestrator/refine-runner using Object.create(ArtifactStore.prototype) pointing at getArtifactsDir()"
  - "BaseAgent exposes convenience getters for provider/logger to minimize agent code changes"

patterns-established:
  - "RunContext injection: all agents receive (stage, ctx: RunContext) constructor"
  - "Bridge pattern: Object.assign(Object.create(ArtifactStore.prototype), { runDir }) for legacy callers"

requirements-completed: [STATE-02, ERR-04]

duration: 19min
completed: 2026-03-26
---

# Phase 02 Plan 02: Agent Layer RunContext Migration Summary

**BaseAgent and all 10 agents migrated from (stage, provider, logger) to (stage, ctx: RunContext) with ArtifactStore-based artifact I/O and instance-scoped EventBus**

## Performance

- **Duration:** 19 min
- **Started:** 2026-03-26T18:01:03Z
- **Completed:** 2026-03-26T18:20:14Z
- **Tasks:** 2
- **Files modified:** 30

## Accomplishments
- BaseAgent constructor changed to (stage, ctx: RunContext) with convenience getters for provider/logger
- All 10 agent implementations (coder, intent-consultant, refine, qa-lead, tester, ui-designer, security-auditor, validator, llm-agent, agent-factory) migrated
- manifest.ts uses ArtifactStore with backward-compatible overloads for orchestrator
- context-manager implements Tier 1 (throw in prod) / Tier 2 (warn) error handling
- Test helpers extended with createTestRunContext() and createTestArtifactStore()
- All test mocks updated to new constructor signatures

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate core modules** - `38fdaca` (feat)
2. **Task 2: Migrate agent-factory and all agents** - `0cdb158` (feat)
3. **Test fix: context-manager test** - `23f7013` (fix)

## Files Created/Modified
- `src/core/agent.ts` - BaseAgent with RunContext constructor, convenience getters
- `src/core/agent-factory.ts` - createAgent accepts RunContext
- `src/core/manifest.ts` - writeManifest/readManifest with ArtifactStore + legacy overloads
- `src/core/event-bus.ts` - Singleton kept with @deprecated tag
- `src/core/context-manager.ts` - Tier 1/2 error handling, ArtifactStore/Logger params
- `src/agents/llm-agent.ts` - Uses ctx.eventBus instead of singleton
- `src/agents/coder.ts` - Full migration: ctx.store, ctx.eventBus
- `src/agents/intent-consultant.ts` - RunContext constructor
- `src/agents/refine-agent.ts` - RunContext constructor
- `src/agents/qa-lead.ts` - ctx.store.getDir(), ctx.eventBus
- `src/agents/tester.ts` - ctx.store, ctx.eventBus
- `src/agents/ui-designer.ts` - ctx.store, ctx.eventBus
- `src/agents/security-auditor.ts` - ctx.store.getDir(), ctx.eventBus
- `src/agents/validator.ts` - ctx.store for readManifest/exists
- `src/__tests__/test-helpers.ts` - createTestRunContext, createTestArtifactStore
- `src/core/orchestrator.ts` - Bridge RunContext for backward compat
- `src/core/refine-runner.ts` - Bridge RunContext for RefineAgent

## Decisions Made
- Kept eventBus singleton with @deprecated tag -- 6 non-agent callers (orchestrator, cli-progress, issue-manager, github-interaction-handler, proposal-handler, refine-runner) still import it. Will be removed in Plan 04.
- Used TypeScript function overloads in manifest.ts to support both old `writeManifest(name, data)` and new `writeManifest(store, name, data)` signatures. This avoids breaking orchestrator and test code before Plan 04 migration.
- Created bridge RunContext objects in orchestrator and refine-runner using `Object.assign(Object.create(ArtifactStore.prototype), { runDir: getArtifactsDir() })` -- lightweight bridge that gives the agent layer a proper RunContext while the orchestrator still uses globals.
- Added convenience getters `protected get provider()` and `protected get logger()` on BaseAgent to minimize code changes in agent implementations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Kept eventBus singleton for non-agent callers**
- **Found during:** Task 1
- **Issue:** Removing the singleton broke 6 non-agent callers (orchestrator, cli-progress, etc.)
- **Fix:** Kept the singleton export with @deprecated JSDoc tag
- **Files modified:** src/core/event-bus.ts
- **Verification:** TypeScript compiles, no runtime errors

**2. [Rule 3 - Blocking] Added backward-compatible function overloads to manifest.ts**
- **Found during:** Task 1
- **Issue:** Changing manifest function signatures broke orchestrator.ts and multiple test files
- **Fix:** Added function overloads supporting both old (name-only) and new (store, name) signatures
- **Files modified:** src/core/manifest.ts
- **Verification:** TypeScript compiles, manifest tests pass

**3. [Rule 3 - Blocking] Added bridge RunContext in orchestrator and refine-runner**
- **Found during:** Task 2
- **Issue:** Orchestrator and refine-runner create agents but don't have a RunContext
- **Fix:** Created bridge RunContext objects using ArtifactStore.prototype trick
- **Files modified:** src/core/orchestrator.ts, src/core/refine-runner.ts
- **Verification:** TypeScript compiles

**4. [Rule 3 - Blocking] Updated all test mocks to new constructor signatures**
- **Found during:** Task 2
- **Issue:** 7 test files used old (stage, provider, logger) constructor pattern
- **Fix:** Updated all vi.mock agent-factory returns and direct agent construction
- **Files modified:** 7 test files (e2e-canary, e2e-phase3/4/5, ui-designer, validator, orchestrator-integration, run-manager, mcp/tools)
- **Verification:** TypeScript compiles

---

**Total deviations:** 4 auto-fixed (4 blocking)
**Impact on plan:** All auto-fixes necessary for backward compatibility with non-migrated modules. No scope creep -- these are the bridge patterns explicitly anticipated by the project's "bridge pattern for backward compatibility" decision.

## Issues Encountered
- context-manager test initially failed because the prompt file `.claude/agents/mosaic/researcher.md` exists in the repo. Fixed by using a non-existent path in the test.
- Pre-existing TypeScript error in `run-manager.ts(77)` (variable 'handler' used before assigned) -- not in scope, documented but not fixed.

## Known Stubs
None -- all code is fully wired.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent layer fully migrated to RunContext pattern
- Orchestrator uses bridge pattern -- ready for Plan 04 migration
- manifest.ts has overloaded API -- Plan 04 can remove legacy overloads
- eventBus singleton deprecated -- Plan 04 can remove it after orchestrator migration

---
*Phase: 02-foundation-layer*
*Completed: 2026-03-26*
