---
phase: 06-integration-wiring-fixes
plan: 02
subsystem: core
tags: [shutdown-coordinator, abort-signal, artifact-io, dependency-injection]

# Dependency graph
requires:
  - phase: 04-coder-decomposition
    provides: ArtifactIO interface and OutputGenerator extraction
  - phase: 03-execution-engine
    provides: ShutdownCoordinator and RunContext with optional signal
  - phase: 05-orchestrator-facade
    provides: Orchestrator thin facade with initRunContext and constructor options
provides:
  - OutputGenerator wired to ArtifactIO for run-scoped artifact access
  - ShutdownCoordinator lifecycle in CLI entry point (run + resume)
  - AbortSignal threaded from CLI through Orchestrator to RunContext
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constructor injection of ArtifactIO into sub-modules for run-scoped access"
    - "ShutdownCoordinator install/uninstall lifecycle with try/finally in CLI commands"

key-files:
  created: []
  modified:
    - src/agents/coder/output-generator.ts
    - src/agents/coder.ts
    - src/index.ts
    - src/core/orchestrator.ts

key-decisions:
  - "ShutdownCoordinator instantiated inside startRun async function to scope lifecycle per invocation"

patterns-established:
  - "Signal propagation: CLI -> Orchestrator constructor -> initRunContext -> RunContext"

requirements-completed: [EXEC-01, EXEC-05]

# Metrics
duration: 6min
completed: 2026-03-27
---

# Phase 06 Plan 02: ShutdownCoordinator + OutputGenerator Wiring Summary

**Wire ShutdownCoordinator into CLI entry with abort signal propagation, and refactor OutputGenerator to use instance-scoped ArtifactIO instead of legacy globals**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-27T08:57:47Z
- **Completed:** 2026-03-27T09:04:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- OutputGenerator now uses ArtifactIO via constructor injection -- zero legacy artifact.ts imports remain
- ShutdownCoordinator instantiated in index.ts for both `run` and `resume` commands with proper install/uninstall lifecycle
- AbortSignal threaded from ShutdownCoordinator through Orchestrator constructor to createRunContext()
- All pipeline runs now respond to SIGINT via the ShutdownCoordinator signal

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor OutputGenerator to accept ArtifactIO via constructor** - `8704cef` (fix)
2. **Task 2: Wire ShutdownCoordinator in index.ts and thread signal through Orchestrator** - `d4d70cd` (fix)

## Files Created/Modified
- `src/agents/coder/output-generator.ts` - Replaced legacy getArtifactsDir/readArtifact with ArtifactIO constructor parameter
- `src/agents/coder.ts` - Pass existing ArtifactIO instance as 4th arg to OutputGenerator
- `src/core/orchestrator.ts` - Added signal field and forward to createRunContext
- `src/index.ts` - Added ShutdownCoordinator lifecycle for run and resume commands

## Decisions Made
- ShutdownCoordinator is instantiated inside the `startRun` async function (not at module level) to scope its lifecycle per command invocation and ensure proper cleanup via try/finally

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 06 integration wiring fixes complete
- System is ready for milestone verification

---
*Phase: 06-integration-wiring-fixes*
*Completed: 2026-03-27*
