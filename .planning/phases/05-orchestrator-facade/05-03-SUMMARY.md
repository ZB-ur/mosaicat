---
phase: 05-orchestrator-facade
plan: 03
subsystem: core
tags: [orchestrator, facade, pipeline-loop, delegation, decomposition]

requires:
  - phase: 05-01
    provides: EventBus singleton deprecation
  - phase: 05-02
    provides: console call elimination
  - phase: 03
    provides: PipelineLoop, StageExecutor, FixLoopRunner
  - phase: 02
    provides: RunContext, ArtifactStore

provides:
  - Thin Orchestrator facade under 200 lines
  - OrchestratorGitOps module for git/issue operations
  - onStageComplete callback in PipelineLoopCallbacks

affects:
  - src/core/orchestrator.ts (rewritten)
  - src/core/pipeline-loop.ts (callback extension)

tech-stack:
  added: []
  patterns: [facade-delegation, callback-hooks, extracted-git-ops]

key-files:
  created:
    - src/core/orchestrator-git-ops.ts
    - src/core/__tests__/orchestrator-facade.test.ts
  modified:
    - src/core/orchestrator.ts
    - src/core/pipeline-loop.ts
    - src/core/__tests__/pipeline-loop.test.ts

decisions:
  - "Extract git/issue operations to OrchestratorGitOps to meet 200-line target -- orchestrator-git-ops.ts (224 lines) holds commitStageArtifacts, postPreviewComment, createStageIssue, createSummaryIssue"
  - "onStageComplete callback only fires for 'done' outcomes, not 'skipped' -- skipped stages did not produce artifacts"

metrics:
  duration: 17min
  completed: 2026-03-26
  tasks: 2
  files: 5
---

# Phase 05 Plan 03: Orchestrator Facade Rewrite Summary

Rewrote 1080-line Orchestrator into 179-line thin facade delegating pipeline execution to PipelineLoop, with git/issue operations extracted to OrchestratorGitOps.

## What Changed

### Task 1: Extend PipelineLoopCallbacks with onStageComplete
- Added optional `onStageComplete` callback to `PipelineLoopCallbacks` interface
- Callback invoked after stage completes with `done` outcome (not `skipped`)
- Added 2 new tests verifying callback behavior for done and skipped stages

### Task 2: Rewrite Orchestrator as Thin Facade
- Orchestrator reduced from 1080 lines to 179 lines (83% reduction)
- Deleted methods: `executeStage()`, `executeAgent()`, `checkTesterVerdict()`, `injectTestFailuresForCoder()`, `closeRolledBackIssues()`, `runStageEvolution()`
- Both `run()` and `resumeRun()` funnel through `executePipeline()` which creates StageExecutor, FixLoopRunner, and PipelineLoop
- Created `OrchestratorGitOps` (224 lines) holding all git/issue helper methods
- PipelineLoop callbacks wire: `savePipelineState` -> facade, `onStageExhausted` -> gitOps.askUserOnStageFail, `onStageComplete` -> gitOps.onStageComplete
- Public API preserved: constructor, run(), resumeRun(), getStageIssues(), eventBus

## Decisions Made

1. **Extract git ops to separate module** -- The orchestrator's git/issue helpers (commitStageArtifacts, postPreviewComment, createStageIssue, createSummaryIssue) total ~200 lines by themselves. Extracting to OrchestratorGitOps was required to meet the 200-line target.

2. **onStageComplete fires only for 'done' outcomes** -- Skipped stages did not produce artifacts, so git commit/issue creation is unnecessary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing module] Created OrchestratorGitOps extraction**
- **Found during:** Task 2
- **Issue:** Git/issue helper methods alone exceeded 200 lines; keeping them in the facade made it impossible to meet the line target
- **Fix:** Extracted to src/core/orchestrator-git-ops.ts
- **Files created:** src/core/orchestrator-git-ops.ts
- **Commit:** e33956a

## Pre-existing Issues (Not Fixed)

- `src/__tests__/e2e-phase5.test.ts` times out -- IntentConsultantAgent always creates CLIInteractionHandler which blocks on stdin in test environment. This was broken before this plan's changes.
- `src/core/__tests__/git-publisher.test.ts` has 1 pre-existing failure (unrelated to orchestrator)
- TypeScript `stage:skipped` event type errors pre-exist in cli-progress.ts, stage-executor.ts

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c587964 | Extend PipelineLoopCallbacks with onStageComplete hook |
| 2 | e33956a | Rewrite Orchestrator as thin facade delegating to PipelineLoop |

## Test Results

- `src/core/__tests__/pipeline-loop.test.ts`: 16 passed (2 new)
- `src/core/__tests__/orchestrator-facade.test.ts`: 8 passed (all new)
- `src/core/__tests__/stage-executor.test.ts`: 14 passed
- `src/core/__tests__/fix-loop-runner.test.ts`: 10 passed

## Known Stubs

None -- all code paths are fully wired with no placeholders.

## Self-Check: PASSED
