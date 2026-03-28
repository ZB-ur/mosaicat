---
phase: quick
plan: 260328-kot
subsystem: agents/coder, core/orchestrator
tags: [bugfix, validation, resume, tdd]
dependency_graph:
  requires: []
  provides: [curly-brace-path-validation, ic-resume-verification]
  affects: [coder-planner, code-plan-schema, orchestrator-facade-tests]
tech_stack:
  added: []
  patterns: [zod-refinement, defensive-sanitization]
key_files:
  created: []
  modified:
    - src/agents/code-plan-schema.ts
    - src/agents/coder/coder-planner.ts
    - src/agents/__tests__/coder-planner.test.ts
    - src/core/__tests__/orchestrator-facade.test.ts
decisions:
  - "Zod refinement on string items (not array-level) for clear per-path error messages"
  - "Sanitize before parse (defense-in-depth): strip braces first, then schema validates as safety net"
metrics:
  duration: 3min
  completed: "2026-03-28T06:59:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
---

# Quick Task 260328-kot: Fix Resume State Persistence and Malformed Coder Paths

Zod refinement rejects curly-brace file paths in CodePlanSchema; CoderPlanner defensively strips braces before validation in both createPlan and loadExistingPlan; IC resume skip logic now covered by 4 verification tests.

## Task Results

### Task 1: Curly-brace path validation and sanitization (TDD)

**RED:** 3 failing tests added -- schema rejects curly braces, createPlan sanitizes, loadExistingPlan sanitizes.
**GREEN:** CodePlanSchema `.refine()` rejects `{`/`}` in file paths. `CoderPlanner.sanitizePlan()` strips braces before `CodePlanSchema.parse()` in both code paths.

**Commits:**
- `5a14417` test(quick-260328-kot): add failing tests for curly-brace path validation
- `4ebbd8b` feat(quick-260328-kot): add curly-brace path validation and sanitization

**Files:** `src/agents/code-plan-schema.ts`, `src/agents/coder/coder-planner.ts`, `src/agents/__tests__/coder-planner.test.ts`

### Task 2: IC resume state persistence verification tests (TDD)

**Tests verify existing fix in orchestrator.ts lines 160-194:**
1. Skips when `intent_consultant.state === 'done'`
2. Skips when `intent-brief.json` artifact exists on disk
3. Skips when downstream `researcher.state === 'done'`
4. `savePipelineState` called after IC completes, in correct order (mark done -> save -> log)

**Commit:** `c0dae87` test(quick-260328-kot): add verification tests for IC resume state persistence

**Files:** `src/core/__tests__/orchestrator-facade.test.ts`

## Deviations from Plan

None - plan executed exactly as written.

## Pre-existing Issues Noted

- `orchestrator-facade.test.ts` "is under 200 lines" test fails: orchestrator.ts is 207 lines (pre-existing, not caused by this plan). Logged but not fixed per scope boundary rules.

## Known Stubs

None.

## Verification

- `npx vitest run src/agents/__tests__/coder-planner.test.ts` -- 9/9 pass
- `npx vitest run src/core/__tests__/orchestrator-facade.test.ts` -- 11/12 pass (1 pre-existing failure)
- `npx tsc --noEmit` -- clean

## Self-Check: PASSED
