---
phase: 05-orchestrator-facade
verified: 2026-03-27T07:11:00Z
status: gaps_found
score: 7/10 must-haves verified
gaps:
  - truth: "EventBus singleton export no longer exists in event-bus.ts"
    status: failed
    reason: "The singleton `export const eventBus = new EventBus()` still exists on line 65 of event-bus.ts. The plan originally targeted removal but the step deviated — the SUMMARY documents the deviation explicitly, noting 15+ consumers could not be migrated in this phase. The singleton carries a @deprecated JSDoc but is still exported."
    artifacts:
      - path: "src/core/event-bus.ts"
        issue: "Line 65: `export const eventBus = new EventBus();` — singleton still present"
    missing:
      - "Either remove the singleton export (and migrate all consumers) or accept the deviation and update the plan truth to reflect the actual delivered state"
  - truth: "No production code imports the deprecated eventBus singleton"
    status: failed
    reason: "This truth is phrased in the must_haves of plan 01, but no production file (outside tests) was found importing `{ eventBus }` — so the singleton is exported but currently not consumed outside tests. However, because the singleton still exists (truth 1 failed), this truth's contractual basis is unstable."
    artifacts:
      - path: "src/core/event-bus.ts"
        issue: "Singleton exported; if any consumer re-adopts it the truth will break again"
    missing:
      - "Remove the singleton or add a lint/tsc rule that prevents new imports of it"
  - truth: "ORCH-02 satisfied: EventBus is instance-scoped, passed via RunContext"
    status: partial
    reason: "REQUIREMENTS.md marks ORCH-02 as [ ] (pending). Orchestrator creates its own `new EventBus()` instance (line 45, orchestrator.ts) and passes it into `createRunContext()`. The instance-based path via RunContext works correctly. However the deprecated singleton export in event-bus.ts means ORCH-02 is not fully closed — the old escape hatch remains."
    artifacts:
      - path: "src/core/event-bus.ts"
        issue: "Singleton still exported — ORCH-02 not considered complete in REQUIREMENTS.md"
    missing:
      - "Remove singleton export to close ORCH-02; update REQUIREMENTS.md checkbox"
human_verification:
  - test: "Confirm CLI output behavior unchanged after console -> process.stdout.write migration"
    expected: "Terminal output visually identical to pre-phase behavior — same text, same line breaks, same formatting for progress, prompts, errors"
    why_human: "process.stdout.write does not append newlines automatically; regression could produce missing newlines in output that grep checks cannot detect"
---

# Phase 05: Orchestrator Facade Verification Report

**Phase Goal:** The Orchestrator is a thin wiring layer that creates RunContext and delegates to PipelineLoop — all console output goes through Logger, EventBus is instance-scoped
**Verified:** 2026-03-27T07:11:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | EventBus singleton export no longer exists in event-bus.ts | FAILED | `event-bus.ts:65` still exports `export const eventBus = new EventBus()` with @deprecated JSDoc |
| 2 | No production code imports the deprecated eventBus singleton | VERIFIED | `grep -rn "{ eventBus }" src/ --include="*.ts"` (excluding tests) returns 0 matches |
| 3 | Infrastructure modules use process.stderr.write instead of console.warn | VERIFIED | retrying-provider.ts:128, snapshot.ts:59, git-publisher.ts:57 all use `process.stderr.write` |
| 4 | Zero console.log/warn/error calls in any non-test src/ file | VERIFIED | grep returns 0 results across all non-test, non-logger src/ files |
| 5 | CLI output behavior identical (same text, same formatting) | NEEDS HUMAN | Mechanical replacement only verifiable by visual inspection |
| 6 | Orchestrator is under 200 lines and delegates pipeline execution to PipelineLoop | VERIFIED | `wc -l src/core/orchestrator.ts` = 179 lines |
| 7 | Orchestrator.run() creates RunContext and calls PipelineLoop.run() | VERIFIED | `initRunContext()` → `createRunContext()` called in `run()` and `resumeRun()`; `executePipeline()` calls `new PipelineLoop(...).run()` |
| 8 | Orchestrator.resumeRun() restores state and calls same PipelineLoop.run() path as run() | VERIFIED | Both `run()` and `resumeRun()` call `this.executePipeline()` which creates PipelineLoop |
| 9 | Existing e2e tests pass without modification | VERIFIED (partial) | orchestrator-facade.test.ts: 8 passed; pipeline-loop.test.ts: 16 passed; e2e-phase5.test.ts pre-existed timeout unrelated to this phase |
| 10 | Git commit, issue creation, and preview comments happen via PipelineLoop callbacks | VERIFIED | `onStageComplete: (stage, r) => this.gitOps!.onStageComplete(stage, r)` wired in `executePipeline()` |

**Score:** 7/10 truths verified (1 failed, 1 partially failed due to upstream, 1 needs human)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/event-bus.ts` | EventBus class export only, no singleton | STUB | Singleton still present at line 65 with @deprecated JSDoc |
| `src/core/retrying-provider.ts` | Retry logging via process.stderr.write | VERIFIED | Line 128: `process.stderr.write(...)` |
| `src/core/snapshot.ts` | Error logging via process.stderr.write | VERIFIED | Line 59: `process.stderr.write(...)` |
| `src/core/git-publisher.ts` | Warning via process.stderr.write | VERIFIED | Line 57: `process.stderr.write(...)` |
| `src/core/cli-progress.ts` | CLI progress display using process.stdout.write | VERIFIED | 35 process.stdout.write calls, 0 console calls |
| `src/index.ts` | CLI entry point using process.stdout/stderr.write | VERIFIED | 0 console calls in non-test production code |
| `src/core/interaction-handler.ts` | CLI interaction using process.stdout.write | VERIFIED | 0 console calls |
| `src/core/evolve-runner.ts` | Evolution CLI using process.stdout.write | VERIFIED | 0 console calls |
| `src/core/refine-runner.ts` | Refine CLI using process.stdout.write | VERIFIED | 0 console calls |
| `src/core/llm-setup.ts` | LLM setup wizard using process.stdout.write | VERIFIED | 0 console calls |
| `src/auth/resolve-auth.ts` | Auth feedback using process.stdout.write | VERIFIED | 0 console calls |
| `src/mcp-entry.ts` | MCP error output using process.stderr.write | VERIFIED | 0 console calls |
| `src/core/orchestrator.ts` | Thin facade delegating to PipelineLoop, under 200 lines | VERIFIED | 179 lines; imports PipelineLoop, StageExecutor, FixLoopRunner; no executeStage/executeAgent methods |
| `src/core/pipeline-loop.ts` | Extended PipelineLoopCallbacks with onStageComplete | VERIFIED | Line 9: optional `onStageComplete` callback in interface; lines 53-54: invoked after `done` outcome |
| `src/core/__tests__/orchestrator-facade.test.ts` | Unit tests for facade delegation | VERIFIED | 8 tests passing; covers PipelineLoop delegation, onStageComplete wiring, OrchestratorGitOps delegation |
| `src/core/orchestrator-git-ops.ts` | Git/issue operations extracted from Orchestrator | VERIFIED | 224 lines; created as unplanned extraction to meet 200-line target |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/core/orchestrator.ts` | `src/core/pipeline-loop.ts` | `new PipelineLoop(executor, fixRunner, ctx, callbacks)` | WIRED | Line 127: `await new PipelineLoop(executor, fixRunner, ctx, {...}).run(run, stages)` |
| `src/core/orchestrator.ts` | `src/core/stage-executor.ts` | `new StageExecutor(ctx, agentsConfig, handler)` | WIRED | Line 125: `const executor = new StageExecutor(ctx, this.agentsConfig, this.handler)` |
| `src/core/orchestrator.ts` | `src/core/fix-loop-runner.ts` | `new FixLoopRunner(executor, ctx)` | WIRED | Line 126: `const fixRunner = new FixLoopRunner(executor, ctx)` |
| `src/evolution/__tests__/proposal-handler.test.ts` | `src/core/event-bus.ts` | `new EventBus` instead of singleton | PARTIAL | Plan 01 deviated; test still uses singleton path indirectly via ProposalHandler's internal event emission |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase modifies structural/output wiring, not data-rendering components.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Orchestrator imports PipelineLoop | `grep 'PipelineLoop' src/core/orchestrator.ts` | 4 matches (import line + usage) | PASS |
| No executeStage/executeAgent in orchestrator | `grep 'executeStage\|executeAgent' src/core/orchestrator.ts` | 0 matches | PASS |
| Zero console calls in non-test src/ | `grep -rn 'console\.(log\|warn\|error)' src/ --include='*.ts' \| grep -v '__tests__\|.test.ts\|logger.ts'` | 0 results | PASS |
| orchestrator-facade tests pass | `npx vitest run src/core/__tests__/orchestrator-facade.test.ts` | 8 passed | PASS |
| pipeline-loop tests pass | `npx vitest run src/core/__tests__/pipeline-loop.test.ts` | 16 passed | PASS |
| TypeScript compiles (production code) | `tsc --noEmit` filtered to non-test errors | 5 pre-existing errors in cli-progress.ts + stage-executor.ts (stage:skipped event type) — pre-existing, unrelated to phase 05 | WARN (pre-existing) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORCH-01 | 05-03-PLAN.md | Rewrite Orchestrator as thin facade (< 200 lines), creates RunContext and delegates to PipelineLoop | SATISFIED | orchestrator.ts is 179 lines; delegates via executePipeline(); REQUIREMENTS.md marked [x] |
| ORCH-02 | 05-01-PLAN.md | EventBus from singleton to instance-scoped via RunContext | PARTIAL | Orchestrator creates `new EventBus()` and passes via RunContext — instance path works. Singleton still exported in event-bus.ts. REQUIREMENTS.md still shows `[ ]` (pending) |
| ORCH-03 | 05-01-PLAN.md, 05-02-PLAN.md | Eliminate 30+ console.log calls, route through Logger | SATISFIED | Zero console calls in all non-test, non-logger src/ files. REQUIREMENTS.md still shows `[ ]` pending — discrepancy between code state and REQUIREMENTS.md tracking |

**Orphaned requirements check:** No additional requirements in REQUIREMENTS.md mapped to Phase 5 beyond ORCH-01, ORCH-02, ORCH-03.

**REQUIREMENTS.md discrepancy:** ORCH-03 is fully satisfied in code (zero console calls verified) but REQUIREMENTS.md still shows `[ ]`. This is a documentation gap, not a code gap. ORCH-02 is partially satisfied — the instance-based path via RunContext works, but the singleton export remains, which is why REQUIREMENTS.md correctly shows it as pending.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/core/event-bus.ts` | 65 | `export const eventBus = new EventBus()` with @deprecated | WARNING | Singleton remains exportable; blocks full ORCH-02 closure. Not a blocker for current behavior since no production code imports it. |
| `src/core/cli-progress.ts` | 114 | `'stage:skipped'` event type error (pre-existing) | INFO | Pre-existing TS error; not introduced by phase 05; does not affect runtime |
| `src/core/stage-executor.ts` | 41 | `'stage:skipped'` event type error (pre-existing) | INFO | Same as above |

---

### Human Verification Required

#### 1. CLI Terminal Output Formatting

**Test:** Run `npx tsx src/index.ts run "test instruction"` and compare terminal output formatting with a pre-phase baseline
**Expected:** All progress messages, prompts, and error messages appear with correct newlines and spacing — no lines that run together
**Why human:** `process.stdout.write` does not auto-append newlines. The ~148 replacements each manually append `\n`. A missing `\n` on any call produces merged output lines that are visually obvious but grep cannot detect.

---

### Gaps Summary

**1 hard gap and 1 soft gap:**

**Hard gap — EventBus singleton removal (ORCH-02 not fully closed):** Plan 01 set a must_have truth that the singleton would be removed. At execution time, the agent found 15+ consumers and kept the singleton with a @deprecated notice instead. This is the correct pragmatic call for the phase, but the truth was not updated to reflect what was actually delivered. The singleton is currently harmless (no production code imports it), but it keeps ORCH-02 open in REQUIREMENTS.md.

**Soft gap — ORCH-03 REQUIREMENTS.md tracking:** The code fully satisfies ORCH-03 (zero console calls in production src/), but the REQUIREMENTS.md checkbox remains `[ ]`. This is a documentation-only gap.

**Pre-existing TypeScript errors** in `cli-progress.ts` and `stage-executor.ts` (stage:skipped event type mismatch) were acknowledged in the SUMMARY as pre-existing and are not attributable to phase 05.

---

_Verified: 2026-03-27T07:11:00Z_
_Verifier: Claude (gsd-verifier)_
