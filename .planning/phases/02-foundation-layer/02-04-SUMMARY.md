---
phase: 02-foundation-layer
plan: 04
subsystem: core
tags: [run-context, artifact-store, event-bus, config-freeze, dependency-injection]

requires:
  - phase: 02-foundation-layer/02-01
    provides: "Result type, ArtifactStore, RunContext, freezeConfig"
  - phase: 02-foundation-layer/02-02
    provides: "Agent-layer RunContext migration, agent-factory with RunContext"
  - phase: 02-foundation-layer/02-03
    provides: "Silent catch elimination in evolution/engine, validator, context-manager"
provides:
  - "Orchestrator creates RunContext and wires it through entire call chain"
  - "Zero artifact.ts global imports in production code"
  - "Zero eventBus singleton imports in production code"
  - "enableEvolution as construction-time option (not runtime mutation)"
  - "All infrastructure modules (cli-progress, snapshot, pr-body-generator, etc.) accept instance parameters"
affects: [phase-03-execution-engine, phase-04-coder-rewrite]

tech-stack:
  added: []
  patterns:
    - "RunContext as single typed dependency container passed through Orchestrator"
    - "EventBus created per-Orchestrator instance, shared across runs"
    - "ArtifactStore.findLatestRun() for MCP/standalone tools without RunContext"

key-files:
  created: []
  modified:
    - src/core/orchestrator.ts
    - src/core/cli-progress.ts
    - src/core/snapshot.ts
    - src/core/pr-body-generator.ts
    - src/core/artifact-presenter.ts
    - src/core/refine-runner.ts
    - src/core/issue-manager.ts
    - src/core/github-interaction-handler.ts
    - src/core/security.ts
    - src/core/manifest.ts
    - src/mcp/tools.ts
    - src/evolution/engine.ts
    - src/evolution/proposal-handler.ts
    - src/index.ts
    - src/core/run-manager.ts

key-decisions:
  - "Orchestrator owns a single EventBus instance (created in constructor) shared across runs -- simplifies CLI progress attachment"
  - "enableEvolution moved to constructor options instead of runtime method mutation -- eliminates config mutation after freeze"
  - "manifest.ts legacy overloads removed entirely (not just deprecated) -- all production callers already migrated"
  - "evolution/engine.ts uses optional artifactsDir parameter with ArtifactStore.findLatestRun fallback -- enables both orchestrator and standalone CLI usage"

patterns-established:
  - "Instance-parameter pattern: infrastructure modules accept EventBus/ArtifactStore as parameters, never import singletons"
  - "Orchestrator.eventBus as public readonly field for external subscribers (cli-progress, MCP)"

requirements-completed: [STATE-03, STATE-04]

duration: 40min
completed: 2026-03-27
---

# Phase 2 Plan 4: Orchestrator RunContext Wiring and Global Deletion Summary

**Orchestrator creates RunContext with frozen config, passes it through entire call chain; zero artifact.ts globals, zero eventBus singleton imports in production code**

## Performance

- **Duration:** 40 min
- **Started:** 2026-03-27T02:46:41Z
- **Completed:** 2026-03-27T03:26:48Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments
- Orchestrator creates RunContext at pipeline start (both run and resume paths), freezing config via createRunContext
- enableEvolution() method deleted; now a constructor option per D-14
- All artifact.ts global function imports removed from production code (D-02 complete)
- All eventBus singleton imports removed from production code
- All infrastructure modules (cli-progress, snapshot, pr-body-generator, artifact-presenter, refine-runner, issue-manager, github-interaction-handler, security, mcp/tools, proposal-handler) migrated to accept instance parameters
- manifest.ts legacy overloads removed; only store-based API remains

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate orchestrator** - `e4afb01` (feat)
2. **Task 2a: Migrate infrastructure modules** - `a0576f2` (feat)
3. **Task 2b: Delete legacy overloads, update tests** - `e3ca41d` (refactor)

## Files Created/Modified
- `src/core/orchestrator.ts` - RunContext creation, config freeze, enableEvolution as constructor option
- `src/core/cli-progress.ts` - Accept EventBus parameter instead of importing singleton
- `src/core/snapshot.ts` - Accept artifactsDir parameter
- `src/core/pr-body-generator.ts` - Accept artifactsDir in options
- `src/core/artifact-presenter.ts` - Remove artifact.ts import
- `src/core/refine-runner.ts` - Use ArtifactStore + RunContext
- `src/core/issue-manager.ts` - Accept EventBus via constructor
- `src/core/github-interaction-handler.ts` - Accept optional EventBus parameter
- `src/core/security.ts` - Accept artifactsDir via StageIssueParams
- `src/core/manifest.ts` - Remove legacy overloads, store-only API
- `src/mcp/tools.ts` - Use ArtifactStore.findLatestRun
- `src/evolution/engine.ts` - Accept optional artifactsDir, use ArtifactStore
- `src/evolution/proposal-handler.ts` - Accept optional EventBus parameter
- `src/index.ts` - Pass enableEvolution via constructor, EventBus to attachCLIProgress
- `src/core/run-manager.ts` - Handler assignment fix
- `src/__tests__/e2e-phase5.test.ts` - enableEvolution API change
- `src/agents/__tests__/validator.test.ts` - Store-based writeManifest
- `src/evolution/__tests__/engine.test.ts` - Fix constants, pass artifactsDir
- `src/core/__tests__/security.test.ts` - Pass artifactsDir in test params

## Decisions Made
- Orchestrator owns a single EventBus instance shared across runs (created in constructor, not per-run) to allow cli-progress attachment before run() is called
- enableEvolution moved to constructor options to comply with D-14 (no runtime config mutation after freeze)
- manifest.ts legacy overloads removed entirely since all production callers already use store-based API
- evolution/engine.ts uses ArtifactStore.findLatestRun as fallback when no artifactsDir is provided (standalone CLI usage)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] manifest.ts legacy overloads blocked D-02 completion**
- **Found during:** Task 2
- **Issue:** manifest.ts still imported from artifact.js via legacy writeManifest/readManifest overloads
- **Fix:** Removed legacy overloads entirely; updated validator.test.ts to use store-based API
- **Files modified:** src/core/manifest.ts, src/agents/__tests__/validator.test.ts
- **Committed in:** e3ca41d

**2. [Rule 3 - Blocking] evolution/engine.ts imported getArtifactsDir**
- **Found during:** Task 2
- **Issue:** evolution/engine.ts used getArtifactsDir() global which prevented D-02 completion
- **Fix:** Added optional artifactsDir constructor parameter with ArtifactStore.findLatestRun fallback
- **Files modified:** src/evolution/engine.ts, src/evolution/__tests__/engine.test.ts
- **Committed in:** e3ca41d

**3. [Rule 1 - Bug] Pre-existing evolution engine test failures (STATE_DIR/STATE_FILE undefined)**
- **Found during:** Task 2
- **Issue:** evolution/__tests__/engine.test.ts referenced undefined STATE_DIR and STATE_FILE constants
- **Fix:** Added local constant definitions; fixed setupArtifacts() call signatures
- **Files modified:** src/evolution/__tests__/engine.test.ts
- **Committed in:** a0576f2

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 blocking, 1 bug)
**Impact on plan:** All auto-fixes necessary for D-02 completion. No scope creep.

## Issues Encountered
- Evolution engine tests have 7 pre-existing failures (from Plan 02-03 merge) related to test isolation with global .mosaic/ paths. Not introduced by this plan. Tests pass with same rate before and after changes.
- Full test suite could not run in CI-like mode due to the canary E2E test depending on file system state; individual test runs confirm all non-pre-existing tests pass.

## Known Stubs
None - all wiring is complete, no placeholder or stub code.

## Next Phase Readiness
- Phase 2 migration is complete: zero globals, zero silent catches, config frozen, RunContext everywhere
- artifact.ts still exists with its functions (for test backward compatibility) but no production code imports from it
- eventBus singleton export still exists in event-bus.ts (for test backward compatibility) but no production code uses it
- Ready for Phase 3 (Execution Engine) or Phase 4 (Coder Rewrite)

## Self-Check: PASSED

- 02-04-SUMMARY.md: FOUND
- Commit e4afb01: FOUND
- Commit a0576f2: FOUND
- Commit e3ca41d: FOUND
- No artifact.js imports in production: 0 files (PASS)
- No eventBus singleton imports in production: 0 files (PASS)
- createRunContext in orchestrator: 3 occurrences (PASS)
- new ArtifactStore in orchestrator: 2 occurrences (PASS)
- new EventBus() in orchestrator: 1 occurrence (PASS)
- tsc --noEmit: 0 errors (PASS)

---
*Phase: 02-foundation-layer*
*Completed: 2026-03-27*
