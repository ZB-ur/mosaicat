---
phase: 04-coder-decomposition
plan: 03
subsystem: agents/coder
tags: [facade, decomposition, refactor]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [thin-facade-coder-agent]
  affects: [src/agents/coder.ts]
tech_stack:
  added: []
  patterns: [facade-pattern, delegation, output-generator-extraction]
key_files:
  created:
    - src/agents/coder/index.ts
    - src/agents/coder/output-generator.ts
    - src/agents/__tests__/coder-facade.test.ts
  modified:
    - src/agents/coder.ts
decisions:
  - "Extract OutputGenerator to separate file to keep facade under 250 lines"
  - "Use class-based mocks (not vi.fn().mockImplementation) for constructor mocking in vitest"
  - "Bridge module-level artifact functions to ArtifactIO interface via createArtifactIO() method"
metrics:
  duration: 38min
  completed: "2026-03-26T21:52:00Z"
---

# Phase 04 Plan 03: Coder Facade Rewrite Summary

Rewrote 1308-line coder.ts monolith into 229-line facade delegating to CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner, and OutputGenerator sub-modules.

## One-liner

Thin facade CoderAgent (229 lines) delegates to 5 sub-modules preserving exact constructor signature and pipeline behavior.

## Completed Tasks

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Rewrite coder.ts as thin facade + barrel export | d1367e4 | src/agents/coder.ts, src/agents/coder/index.ts, src/agents/coder/output-generator.ts |
| 2 | Create facade delegation tests (TDD) | 049822c | src/agents/__tests__/coder-facade.test.ts |

## Changes Made

### Task 1: Facade Rewrite
- Replaced 1308-line CoderAgent with 229-line facade
- Extracted all private methods (runPlanner, runSkeleton, runBuildFix, etc.) -- they now live in sub-modules
- Removed all module-level constants (moved to sub-modules in Plans 01/02)
- Created `OutputGenerator` class in `coder/output-generator.ts` for manifest and README generation
- Created barrel export `coder/index.ts` re-exporting all 6 sub-modules
- Constructor signature unchanged: `(stage, provider, logger, interactionHandler?)`
- `agent-factory.ts` requires zero changes
- `getOutputSpec()` preserved exactly

### Task 2: Facade Tests
- 15 tests covering delegation flow, constructor compatibility, line count meta-test
- Mocks all 5 sub-modules (CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner, OutputGenerator)
- Verifies orchestration sequence: plan -> skeleton -> setup -> verify -> implement -> build -> acceptance -> analyze -> smoke -> output

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] OutputGenerator extraction to stay under 250 lines**
- **Found during:** Task 1
- **Issue:** generateManifest + generateReadme + buildDirectoryTree + escapeForMermaid totaled ~185 lines, pushing facade to 415 lines
- **Fix:** Extracted output formatting to `coder/output-generator.ts` with OutputWriter callback interface
- **Files created:** src/agents/coder/output-generator.ts
- **Commit:** d1367e4

**2. [Rule 1 - Bug] Class-based mocks for constructor testing**
- **Found during:** Task 2
- **Issue:** `vi.fn().mockImplementation(() => ({...}))` not callable with `new` in vitest
- **Fix:** Used class-based mock pattern (MockCoderPlanner, etc.) instead of function mocks
- **Files modified:** src/agents/__tests__/coder-facade.test.ts
- **Commit:** 049822c

## Verification Results

- `wc -l src/agents/coder.ts` = 229 (target < 250)
- `npx tsc --noEmit` passes (no new errors; pre-existing: test-helpers import, run-manager)
- `npx vitest run src/agents/__tests__/coder-facade.test.ts` = 15/15 passed
- `grep -c 'new CoderPlanner' src/agents/coder.ts` = 1
- `grep -c 'new CoderBuilder' src/agents/coder.ts` = 1
- `grep -c 'new BuildVerifier' src/agents/coder.ts` = 1
- `grep -c 'new SmokeRunner' src/agents/coder.ts` = 1
- agent-factory.ts unchanged

## Known Stubs

None -- all delegation is to real sub-module interfaces.

## Decisions Made

1. **OutputGenerator extraction** -- generateManifest/generateReadme moved to separate file because keeping them inline exceeded the 250-line target. Uses OutputWriter callback interface to bridge BaseAgent.writeOutput/writeOutputManifest.
2. **ArtifactIO bridge** -- The facade creates an ArtifactIO adapter from module-level artifact functions (writeArtifact, readArtifact, artifactExists, getArtifactsDir) to pass to sub-modules via CoderDeps.
