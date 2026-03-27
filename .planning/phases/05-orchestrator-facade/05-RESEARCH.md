# Phase 5: Orchestrator Facade + Logging Cleanup - Research

**Researched:** 2026-03-27
**Domain:** Orchestrator refactoring, logging unification, EventBus singleton removal
**Confidence:** HIGH

## Summary

The Orchestrator (`src/core/orchestrator.ts`) is currently 1080 lines and contains duplicated logic that Phase 3 already extracted into `PipelineLoop`, `StageExecutor`, and `FixLoopRunner`. The rewrite is a **delegation refactor** -- the new Orchestrator creates `RunContext`, wires dependencies, and delegates execution to `PipelineLoop`. All stage execution, retry, clarification, gate handling, and fix loop logic already exists in Phase 3 modules.

The console.log cleanup spans 12 non-test files totaling ~151 console calls. These break into two categories: (1) **CLI presentation layer** (`cli-progress.ts`, `index.ts`, `interaction-handler.ts`, `llm-setup.ts`, `evolve-runner.ts`, `refine-runner.ts`) where `console.log` is the intentional output mechanism and should remain as-is or be wrapped in a thin `CLIOutput` abstraction, and (2) **infrastructure modules** (`logger.ts`, `snapshot.ts`, `git-publisher.ts`, `retrying-provider.ts`, `mcp-entry.ts`, `resolve-auth.ts`) where console calls bypass the Logger and should be converted.

EventBus is already instantiated per-run in `RunContext` (Phase 2). The singleton `eventBus` export in `event-bus.ts` is marked `@deprecated`. The remaining work is removing the singleton export and confirming no production code imports it.

**Primary recommendation:** Rewrite Orchestrator as a ~150-line thin facade that creates RunContext + PipelineLoop and delegates. Replace infrastructure-layer console calls with Logger. Leave CLI presentation layer console calls in place (they ARE the output channel for terminal users).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion -- pure infrastructure phase (orchestrator refactoring + logging cleanup). Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key areas requiring decisions:
- How to slim the Orchestrator from ~900 lines to <200 lines
- How to wire PipelineLoop (from Phase 3) into the Orchestrator
- Strategy for finding and replacing all console.log/warn/error calls
- EventBus singleton removal approach (already per-run in Phase 2, just need to verify/cleanup)

### Deferred Ideas (OUT OF SCOPE)
None -- infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-01 | Rewrite Orchestrator as thin facade (<200 lines), create RunContext and delegate to PipelineLoop | Current orchestrator is 1080 lines. PipelineLoop, StageExecutor, FixLoopRunner all exist from Phase 3. Orchestrator duplicates their logic in `run()`, `resumeRun()`, `executeStage()`. Facade keeps: constructor, `run()`, `resumeRun()`, `getStageIssues()` as public API; delegates pipeline execution to PipelineLoop. |
| ORCH-02 | EventBus from singleton to instance, passed via RunContext | Already done in Phase 2. Singleton `eventBus` export still exists with `@deprecated` tag. Only 1 production import of singleton remains (proposal-handler test). Remove the deprecated singleton export. |
| ORCH-03 | Unify 30+ console.log calls to Logger module, eliminate bypass of logger | 151 console calls across 12 non-test files. ~35 in cli-progress.ts (CLI output layer -- needs design decision), ~35 in index.ts (CLI entry -- same), ~14 in interaction-handler.ts, ~32 in evolve-runner.ts, ~15 in refine-runner.ts. Infrastructure files have ~20 calls total that should use Logger. |
</phase_requirements>

## Architecture Patterns

### Current Orchestrator Structure (1080 lines)
The orchestrator currently contains:
1. **Constructor** (~20 lines) -- config loading, handler setup, EventBus creation
2. **`run()`** (~160 lines) -- RunContext creation, intent consultant, stage loop with fix loop, evolution, PR publish
3. **`resumeRun()`** (~145 lines) -- nearly identical to `run()` with state restoration
4. **`executeStage()`** (~200 lines) -- duplicates StageExecutor logic
5. **`executeAgent()`** (~65 lines) -- duplicates StageExecutor.executeAgent
6. **Git/Issue helpers** (~300 lines) -- `commitStageArtifacts`, `postPreviewComment`, `createStageIssue`, `createSummaryIssue`, `closeRolledBackIssues`
7. **Utility methods** (~90 lines) -- `savePipelineState`, `resolveStageList`, `checkTesterVerdict`, `injectTestFailuresForCoder`, `askUserOnStageFail`
8. **Evolution methods** (~55 lines) -- `runStageEvolution`, `runEvolution`

### Target Facade Structure (~150-180 lines)
```
Orchestrator (facade)
  constructor(handler?, adapter?, options?)   // Config load, EventBus creation
  run(instruction, autoApprove, profile?)     // Create RunContext → PipelineLoop.run()
  resumeRun(runId?, fromStage?)               // Restore state → PipelineLoop.run()
  getStageIssues()                            // Passthrough
```

### What Moves Where

| Current Method | Target Location | Rationale |
|----------------|-----------------|-----------|
| `executeStage()` | Already in `StageExecutor` | Exact duplicate |
| `executeAgent()` | Already in `StageExecutor` | Exact duplicate |
| Fix loop logic in `run()`/`resumeRun()` | Already in `FixLoopRunner` | Exact duplicate |
| Stage iteration in `run()`/`resumeRun()` | Already in `PipelineLoop` | Exact duplicate |
| `commitStageArtifacts()` | New: `GitStagePublisher` or PipelineLoop callback | Git-specific, not core orchestration |
| `postPreviewComment()` | New: `GitStagePublisher` or PipelineLoop callback | Git-specific |
| `createStageIssue()` | Existing: `IssueManager` (already exists in codebase) | Issue management already extracted |
| `createSummaryIssue()` | PipelineLoop callback or post-run hook | Summary is post-pipeline |
| `closeRolledBackIssues()` | PipelineLoop callback | Issue lifecycle |
| `savePipelineState()` | PipelineLoop callback (already wired as `PipelineLoopCallbacks.savePipelineState`) | Already designed for this |
| `resolveStageList()` | Keep in Orchestrator (pre-loop) | Config resolution before loop |
| `checkTesterVerdict()` | Already in `StageExecutor` and `FixLoopRunner` | Exact duplicate |
| `injectTestFailuresForCoder()` | Already in `FixLoopRunner` | Exact duplicate |
| `askUserOnStageFail()` | PipelineLoop callback (already wired as `PipelineLoopCallbacks.onStageExhausted`) | Already designed for this |
| `runEvolution()` | Keep as post-run hook in facade or extract | Small, called once |
| `runStageEvolution()` | Dead code (comment says "Stage-level evolution removed") | Delete |
| `runIntentConsultant()` | Keep in facade (pre-loop special case) | Runs before pipeline loop |

### Recommended Wiring Pattern
```typescript
// Orchestrator.run() pseudocode (~40 lines)
async run(instruction, autoApprove, profile?) {
  const stageList = this.resolveStageList(profile);
  const runId = `run-${Date.now()}`;
  const store = new ArtifactStore('.mosaic/artifacts', runId);
  const logger = new Logger(runId);
  const provider = createProvider(this.pipelineConfig);
  const ctx = createRunContext({ store, logger, provider, eventBus: this.eventBus, config: this.pipelineConfig, devMode: this.devMode });

  const pipelineRun = createPipelineRun(runId, instruction, autoApprove, stageList);
  await this.runIntentConsultant(pipelineRun, ctx);

  const executor = new StageExecutor(ctx, this.agentsConfig, this.handler);
  const fixRunner = new FixLoopRunner(executor, ctx);
  const loop = new PipelineLoop(executor, fixRunner, ctx, {
    savePipelineState: (run, fixRound) => this.savePipelineState(run, profile ?? 'full', fixRound),
    onStageExhausted: (stage, retryCount, error) => this.askUserOnStageFail(stage, retryCount, error),
  });

  const pipelineStages = stageList.filter(s => s !== 'intent_consultant');
  await loop.run(pipelineRun, pipelineStages);

  // Post-run: evolution, PR publish, summary issue
  if (this.evolutionEnabled) await this.runEvolution(runId, ctx);
  await this.publishPR(pipelineRun, ctx);

  return pipelineRun;
}
```

### Gap Analysis: PipelineLoop Missing Features

The current PipelineLoop does NOT handle these orchestrator responsibilities that need to be wired in:

1. **Git commit after each stage** -- `commitStageArtifacts()` is called after agent execution. This should become a PipelineLoop callback or event handler.
2. **Preview comments** -- `postPreviewComment()` for ui_designer. Same: callback or event.
3. **Stage issue creation** -- `createStageIssue()` after each stage completes. Same approach.
4. **Stage metrics tracking** -- `stageMetrics` Map. Can move to a separate `MetricsCollector` subscribed to EventBus.

**Recommendation:** Add an `onStageComplete` callback to `PipelineLoopCallbacks` that receives stage name and allows git commit + issue creation. This avoids modifying the already-tested PipelineLoop internals.

### Anti-Patterns to Avoid
- **Passing the entire Orchestrator to PipelineLoop** -- violates separation. Pass only typed callbacks.
- **Adding git logic to PipelineLoop** -- PipelineLoop is git-agnostic by design.
- **Keeping duplicate code "just in case"** -- the Phase 3 modules are tested; trust them.

## Console.log Cleanup Strategy

### Classification of 151 console calls

| File | Count | Category | Action |
|------|-------|----------|--------|
| `cli-progress.ts` | 35 | CLI output layer | **Keep** -- this IS the terminal renderer |
| `index.ts` | 35 | CLI entry point | **Keep** -- user-facing CLI output |
| `evolve-runner.ts` | 32 | Interactive CLI tool | **Keep** -- standalone CLI command |
| `refine-runner.ts` | 15 | Interactive CLI tool | **Keep** -- standalone CLI command |
| `llm-setup.ts` | 14 | Interactive CLI tool | **Keep** -- standalone CLI setup wizard |
| `interaction-handler.ts` | 14 | CLI interaction | **Keep** -- terminal prompts |
| `retrying-provider.ts` | 1 | Infrastructure | **Replace** with `logger.pipeline('warn', ...)` |
| `snapshot.ts` | 1 | Infrastructure | **Replace** with `logger.pipeline('warn', ...)` |
| `git-publisher.ts` | 1 | Infrastructure | **Replace** with `logger.pipeline('warn', ...)` |
| `logger.ts` | 1 | Meta-logging | **Keep** -- logger's own error handler (can't log via self) |
| `mcp-entry.ts` | 1 | Entry point | **Keep** -- process-level error before logger exists |
| `resolve-auth.ts` | 1 | CLI interaction | **Keep** -- user-facing auth feedback |

### Key Insight: ORCH-03 Interpretation

The requirement says "统一 30+ 处 console.log 到 Logger 模块". The 30+ count likely refers to the infrastructure/pipeline code paths, not the CLI presentation layer. The CLI presentation layer (`cli-progress.ts`, `index.ts`) uses `console.log` intentionally as its output channel -- it's the ANSI-formatted terminal UI.

**Recommendation:** Replace the 3-4 infrastructure-layer console calls (`retrying-provider.ts`, `snapshot.ts`, `git-publisher.ts`) with Logger. These modules already have access to Logger or RunContext. For `snapshot.ts` and `git-publisher.ts` which lack Logger access, the callers already catch and log errors, so we can simply remove the redundant console.warn and let the error propagate.

The success criterion "Zero console.log/console.warn/console.error calls remain in src/" is strict. If literally enforced, `cli-progress.ts` (35 calls) would need to be rewritten to use a different output mechanism. Two approaches:

1. **Strict interpretation:** Create a `CLIOutput` class that wraps `process.stdout.write` / `process.stderr.write` instead of `console.log`. This is semantically the same but satisfies "no console.log".
2. **Practical interpretation:** Exclude the CLI presentation layer (`cli-progress.ts`, `index.ts`, `interaction-handler.ts`) and standalone CLI tools (`evolve-runner.ts`, `refine-runner.ts`, `llm-setup.ts`) since they are the terminal UI, not pipeline internals. Only clean up infrastructure modules.

**Recommendation:** Take the **strict interpretation** for rigor. Replace `console.log` in `cli-progress.ts` with `process.stdout.write(msg + '\n')` and `console.error` with `process.stderr.write(msg + '\n')`. This satisfies the "zero console.log" criterion without changing behavior. For `index.ts` and other CLI entry points, same approach. It's a mechanical search-and-replace.

## EventBus Singleton Removal

### Current State
- `event-bus.ts` exports both `EventBus` class and `eventBus` singleton (line 65, marked `@deprecated`)
- Orchestrator creates its own `EventBus` instance in constructor (line 89)
- All Phase 3 modules receive EventBus via `RunContext`
- Only 1 non-test import of the singleton: `src/evolution/__tests__/proposal-handler.test.ts` (test file)
- `cli-progress.ts` receives EventBus as parameter via `attachCLIProgress(bus)`

### Action
1. Remove the `@deprecated` singleton export from `event-bus.ts`
2. Update the test file to create its own `EventBus` instance
3. Verify `tsc` compiles clean

This is a 3-line change plus test update. Low risk.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stage execution | Custom loop in Orchestrator | `PipelineLoop` (Phase 3) | Already tested, handles all outcomes |
| Fix loop | Index manipulation in Orchestrator | `FixLoopRunner` (Phase 3) | Progressive strategy already implemented |
| Stage retry/gate | Recursive executeStage | `StageExecutor` (Phase 3) | Returns StageOutcome, no recursion |
| Shutdown handling | Custom signal handlers | `ShutdownCoordinator` (Phase 3) | Already wired to AbortSignal |

## Common Pitfalls

### Pitfall 1: Breaking the E2E Tests
**What goes wrong:** `e2e-phase5.test.ts` creates `Orchestrator` directly and calls `orchestrator.run()`. Changing the Orchestrator public API will break it.
**Why it happens:** Tests couple to constructor signature and method names.
**How to avoid:** Keep the same public API: `constructor(handler?, adapter?, options?)`, `run()`, `resumeRun()`, `getStageIssues()`. The internal wiring changes, the surface doesn't.
**Warning signs:** Test imports that reference removed private methods.

### Pitfall 2: PipelineLoop Missing Callbacks
**What goes wrong:** Orchestrator has git commit, issue creation, and PR preview logic that PipelineLoop doesn't know about. Removing orchestrator's `executeStage()` without wiring these into PipelineLoop callbacks silently drops features.
**Why it happens:** PipelineLoop was designed as a pure execution engine. Git operations are layered on top.
**How to avoid:** Extend `PipelineLoopCallbacks` with `onStageComplete?(stage, run)` or subscribe to EventBus events from the orchestrator.
**Warning signs:** GitHub mode stops creating stage issues or committing artifacts.

### Pitfall 3: Resume Path Divergence
**What goes wrong:** `run()` and `resumeRun()` have slightly different setup (resume restores state, validates, handles `--from`). After refactoring, they must both funnel into the same PipelineLoop.run() path.
**Why it happens:** Copy-paste divergence between run and resume in the original code.
**How to avoid:** Both methods create RunContext and PipelineRun, then call the same `this.executePipeline(pipelineRun, stageList, ctx)` helper that constructs and runs PipelineLoop.
**Warning signs:** Resume behaves differently from fresh run on identical state.

### Pitfall 4: Logger Not Available in CLI Entry
**What goes wrong:** `index.ts` runs before any pipeline run exists, so there's no Logger instance. Trying to route CLI output through Logger is wrong.
**Why it happens:** Logger is scoped to a pipeline run directory. CLI entry point is pre-run.
**How to avoid:** Use `process.stdout.write`/`process.stderr.write` for pre-run CLI output. Logger is for pipeline execution.

### Pitfall 5: Intent Consultant Special Casing
**What goes wrong:** IntentConsultant runs BEFORE the pipeline loop. It uses a hardcoded `CLIInteractionHandler` and a placeholder stage name `'researcher'`. This must stay as a pre-loop step in the facade.
**Why it happens:** IntentConsultant is not a normal pipeline stage -- it's multi-turn dialogue.
**How to avoid:** Keep `runIntentConsultant()` as a private method in the Orchestrator facade. Don't try to push it into PipelineLoop.

## Code Examples

### Orchestrator Facade Skeleton
```typescript
// Source: derived from current orchestrator.ts + Phase 3 modules
export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;
  private handler: InteractionHandler;
  private adapter?: GitPlatformAdapter;
  private evolutionEnabled: boolean;
  private devMode: boolean;
  readonly eventBus: EventBus;

  constructor(
    handler?: InteractionHandler,
    adapter?: GitPlatformAdapter,
    options?: { enableEvolution?: boolean; devMode?: boolean },
  ) {
    // Same config loading as current
    this.eventBus = new EventBus();
  }

  async run(instruction: string, autoApprove = false, profile?: PipelineProfile): Promise<PipelineRun> {
    const stageList = this.resolveStageList(profile);
    const ctx = this.createRunContext(runId);
    const pipelineRun = createPipelineRun(runId, instruction, autoApprove, stageList);

    await this.runIntentConsultant(pipelineRun, ctx);
    await this.executePipeline(pipelineRun, stageList, ctx, profile);
    await this.postRun(pipelineRun, ctx);

    return pipelineRun;
  }

  async resumeRun(runId?: string, fromStage?: string): Promise<PipelineRun> {
    // Resolve + validate state, create ctx, restore stages
    await this.executePipeline(pipelineRun, stageList, ctx, validated.profile);
    return pipelineRun;
  }

  private async executePipeline(run: PipelineRun, stageList: readonly StageName[], ctx: RunContext, profile?: string) {
    const executor = new StageExecutor(ctx, this.agentsConfig, this.handler);
    const fixRunner = new FixLoopRunner(executor, ctx);
    const loop = new PipelineLoop(executor, fixRunner, ctx, this.buildCallbacks(run, profile));
    await loop.run(run, stageList.filter(s => s !== 'intent_consultant'));
  }
}
```

### Console.log Replacement Pattern
```typescript
// Before (retrying-provider.ts)
console.warn(`[retry] attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);

// After -- use logger if available, or structured stderr
// Option A: Accept logger in constructor (preferred)
this.logger.pipeline('warn', 'retry:backoff', { attempt, delayMs: Math.round(delay), error: error.message });

// Option B: For modules without logger access, use process.stderr
process.stderr.write(`[retry] attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}\n`);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/core/__tests__/pipeline-loop.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-01 | Orchestrator delegates to PipelineLoop, under 200 lines | unit + integration | `npx vitest run src/core/__tests__/orchestrator-facade.test.ts -x` | Wave 0 |
| ORCH-02 | EventBus singleton removed, instance via RunContext | unit | `npx vitest run src/core/__tests__/event-bus.test.ts -x` | Existing (needs update) |
| ORCH-03 | Zero console.log in src/ (excluding tests) | grep audit | `grep -r 'console\.\(log\|warn\|error\)' src/ --include='*.ts' \| grep -v '__tests__' \| grep -v '.test.ts' \| wc -l` | N/A (script check) |
| ORCH-01 | resume path works through PipelineLoop | integration | `npx vitest run src/__tests__/e2e-phase5.test.ts -x` | Existing (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/core/__tests__/orchestrator-facade.test.ts src/core/__tests__/pipeline-loop.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `grep -rc 'console\.\(log\|warn\|error\)' src/ --include='*.ts' | grep -v __tests__ | grep -v .test.ts | grep -v ':0$'` returns empty

### Wave 0 Gaps
- [ ] `src/core/__tests__/orchestrator-facade.test.ts` -- covers ORCH-01 (facade delegates to PipelineLoop, line count < 200)
- [ ] Update `src/__tests__/e2e-phase5.test.ts` -- verify existing e2e tests pass with new facade
- [ ] Update `src/evolution/__tests__/proposal-handler.test.ts` -- remove singleton eventBus import

## Detailed File Inventory

### Files to Modify

| File | Lines | Change | Complexity |
|------|-------|--------|------------|
| `src/core/orchestrator.ts` | 1080 | Rewrite to ~150-180 line facade | HIGH |
| `src/core/event-bus.ts` | 68 | Remove singleton export (line 65) | LOW |
| `src/core/retrying-provider.ts` | ~130 | Replace 1 console.warn with logger | LOW |
| `src/core/snapshot.ts` | ~60 | Replace 1 console.warn (or remove -- caller logs) | LOW |
| `src/core/git-publisher.ts` | ~60 | Replace 1 console.warn with logger | LOW |
| `src/core/cli-progress.ts` | ~240 | Replace 35 console.log with process.stdout.write | MEDIUM |
| `src/index.ts` | 173 | Replace 35 console.log/error with process.stdout/stderr.write | MEDIUM |
| `src/core/interaction-handler.ts` | ~120 | Replace 14 console.log with process.stdout.write | LOW |
| `src/core/evolve-runner.ts` | ~270 | Replace 32 console.log with process.stdout.write | MEDIUM |
| `src/core/refine-runner.ts` | ~150 | Replace 15 console.log with process.stdout.write | LOW |
| `src/core/llm-setup.ts` | ~200 | Replace 14 console.log with process.stdout.write | LOW |
| `src/auth/resolve-auth.ts` | ~100 | Replace 1 console.log with process.stdout.write | LOW |
| `src/mcp-entry.ts` | ~10 | Replace 1 console.error with process.stderr.write | LOW |

### Files to Add
| File | Purpose |
|------|---------|
| `src/core/__tests__/orchestrator-facade.test.ts` | Unit tests for new facade |

### Files NOT to Modify
| File | Reason |
|------|--------|
| `src/core/pipeline-loop.ts` | Phase 3, stable, tested |
| `src/core/stage-executor.ts` | Phase 3, stable, tested |
| `src/core/fix-loop-runner.ts` | Phase 3, stable, tested |
| `src/core/run-context.ts` | Phase 2, frozen |
| `src/core/pipeline.ts` | Frozen module |
| `src/core/logger.ts` | Keep its 1 console.error (logger's own error handler -- can't log via itself) |

## Open Questions

1. **PipelineLoop Callbacks for Git Operations**
   - What we know: PipelineLoop has `savePipelineState` and `onStageExhausted` callbacks but no `onStageComplete` hook for git commit / issue creation.
   - What's unclear: Should we extend `PipelineLoopCallbacks` interface, or subscribe to EventBus events?
   - Recommendation: Extend `PipelineLoopCallbacks` with `onStageComplete?(stage: StageName, run: PipelineRun): Promise<void>`. EventBus subscription is also viable but callbacks are more explicit and already the pattern used.

2. **RetryingProvider Logger Access**
   - What we know: `RetryingProvider` wraps any `LLMProvider` and adds retry logic. It has 1 console.warn for backoff logging.
   - What's unclear: RetryingProvider constructor doesn't accept Logger. Adding it means changing the provider-factory and all callers.
   - Recommendation: Add optional `Logger` parameter to RetryingProvider constructor. Provider factory already has config context to create Logger. Alternatively, just use `process.stderr.write` since RetryingProvider operates outside Logger's run-scoped lifecycle.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of `src/core/orchestrator.ts` (1080 lines, full read)
- Direct analysis of `src/core/pipeline-loop.ts`, `stage-executor.ts`, `fix-loop-runner.ts` (Phase 3 modules)
- Direct analysis of `src/core/event-bus.ts` (singleton status confirmed)
- `grep -r console` audit across all src/ non-test files (151 calls identified)

### Secondary (MEDIUM confidence)
- Phase 2/3 decision history from `.planning/STATE.md`
- E2E test coverage from `src/__tests__/e2e-phase5.test.ts`

## Metadata

**Confidence breakdown:**
- Orchestrator rewrite: HIGH -- all target modules read, duplication confirmed, public API identified
- Console cleanup: HIGH -- exhaustive grep audit completed, every file categorized
- EventBus cleanup: HIGH -- singleton import graph traced, only 1 non-test consumer

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable domain, no external dependencies)
