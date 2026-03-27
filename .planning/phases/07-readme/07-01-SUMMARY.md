---
phase: 07-readme
plan: 01
subsystem: docs
tags: [readme, documentation, chinese, english, architecture-diagram, mermaid]

# Dependency graph
requires:
  - phase: 02-foundation-layer
    provides: ArtifactStore, RunContext, RetryingProvider with circuit breaker
  - phase: 03-execution-engine
    provides: PipelineLoop, StageExecutor, FixLoopRunner, ShutdownCoordinator
  - phase: 05-orchestrator-facade
    provides: Orchestrator thin facade (181 lines)
provides:
  - v2-accurate README.md (Chinese) and README.en.md (English)
  - Updated architecture mermaid diagram with v2 engine modules
  - Terminal demo output block
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - README.md
    - README.en.md

key-decisions:
  - "Used formatted code block for terminal demo instead of screenshot/recording (no recording tools available, more maintainable)"
  - "Exposed v2 internal class names (PipelineLoop, StageExecutor, etc.) in Architecture section but kept How It Works section behavior-focused"
  - "Added v2 Core Engine Rewrite as separate roadmap entry to highlight phases 2-6 work"

patterns-established: []

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08]

# Metrics
duration: 8min
completed: 2026-03-27
---

# Phase 7 Plan 1: README Rewrite Summary

**Rewrote README.md (Chinese) and README.en.md (English) with v2-accurate architecture content: bounded retry + circuit breaker, PipelineLoop/StageExecutor/FixLoopRunner/ShutdownCoordinator in architecture diagram, terminal demo block, reorganized section order, technical tone**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-27T12:44:56Z
- **Completed:** 2026-03-27T12:52:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed all stale "infinite retry" claims to "bounded retry (max 20) + circuit breaker (5 failures, 30s recovery)" across both files
- Updated architecture mermaid diagram with v2 engine modules (PipelineLoop, StageExecutor, FixLoopRunner, ShutdownCoordinator, RunContext, ArtifactStore)
- Added terminal demo code block showing realistic pipeline run output
- Reorganized section order: Demo first, Comparison earlier, consolidated Quick Start with prerequisites
- Removed all TODO HTML comments (banner placeholder, demo GIF placeholder, contrib.rocks placeholder, Star History section)
- Structural parity verified: both files have 12 level-2 sections in identical order

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite README.md** - `f2a0f23` (feat)
2. **Task 2: Rewrite README.en.md** - `55da980` (feat)

## Files Created/Modified
- `README.md` - Chinese README rewritten with v2-accurate content, reorganized structure, technical tone
- `README.en.md` - English README translated to match Chinese version with structural parity

## Decisions Made
- Used formatted code block for terminal demo instead of screenshot/recording (no recording tools installed, code block is more maintainable and renders well on GitHub)
- Exposed v2 internal class names in Architecture section and v2 Engine Modules table, but kept How It Works pipeline diagram behavior-focused
- Added "v2 Core Engine Rewrite" as separate completed entry in Roadmap to highlight the phases 2-6 work

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All README content is v2-accurate
- No further phases planned (Phase 7 is the final phase)

## Self-Check: PASSED

---
*Phase: 07-readme*
*Completed: 2026-03-27*
