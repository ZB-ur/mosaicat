# Phase 3: Execution Engine - Research

**Researched:** 2026-03-27
**Domain:** Pipeline execution loop, retry/circuit-breaker, graceful shutdown, stage isolation
**Confidence:** HIGH

## Summary

Phase 3 transforms the Orchestrator's recursive `executeStage()` into an iterative `while` loop with a `StageOutcome` discriminated union, extracts the Tester-Coder fix loop into an independent `FixLoopRunner`, adds circuit-breaker logic to `RetryingProvider`, and implements graceful shutdown via `ShutdownCoordinator`. The current codebase has three recursive `return this.executeStage(run, stage)` calls (retry on failure, retry on rejection, manual retry after exhaustion) and a duplicated Tester-Coder fix loop in both `run()` and `resumeRun()`.

The existing `RetryingProvider` has `maxRetries: Infinity` by default with no circuit breaker. The `RunContext` already carries an `AbortSignal` (created from `AbortController` in `createRunContext()`) but nothing signals it on SIGINT/SIGTERM. Phase 2 laid all the groundwork: `RunContext`, `ArtifactStore`, `Result<T,E>`, frozen config. This phase consumes those foundations.

**Primary recommendation:** Hand-roll the circuit breaker (~80 lines) rather than adding cockatiel as a dependency -- the project needs only a consecutive-failure counter with half-open recovery, and cockatiel's last publish was July 2024. The `StageOutcome` discriminated union plus a `while` loop in `PipelineLoop` eliminates all recursion and centralizes control flow.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices at Claude's discretion (infrastructure phase).

### Claude's Discretion
- StageOutcome discriminated union design (variant names, payload shapes)
- FixLoopRunner interface and progressive strategy implementation
- Circuit breaker parameters (5 consecutive failures threshold, 30s half-open recovery from success criteria)
- ShutdownCoordinator signal handling and cleanup strategy
- StageExecutor boundary (what goes in vs stays in PipelineLoop)

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXEC-01 | Orchestrator uses `while` iterative loop + `StageOutcome` discriminated union, no recursive `executeStage` | StageOutcome union design, PipelineLoop pattern, existing recursion sites identified |
| EXEC-02 | Extract Tester-Coder fix loop into independent `FixLoopRunner` with progressive strategy | Current fix loop code analyzed (duplicated in run/resumeRun), FixLoopRunner interface designed |
| EXEC-03 | `StageExecutor` for single-stage execution + retry + gate, `PipelineLoop` for stage orchestration | Separation of concerns pattern, existing executeStage decomposition mapped |
| EXEC-04 | RetryingProvider with max 20 retries + circuit breaker (5 consecutive failures, 30s half-open) | Hand-roll decision (vs cockatiel), circuit breaker state machine design |
| EXEC-05 | ShutdownCoordinator: SIGINT/SIGTERM completes current artifact write before exit | Node.js signal handling patterns, AbortSignal integration with RunContext |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.0 | Test runner | Already installed, project standard |
| eventemitter3 | ^5.0.4 | Event bus | Already installed, used by EventBus |
| zod | ^4.3.6 | Schema validation | Already installed, project standard |

### Supporting
No new dependencies needed. Circuit breaker is hand-rolled (~80 lines).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled circuit breaker | cockatiel ^3.2.1 | cockatiel is well-designed but adds a dependency for ~80 lines of logic; last published July 2024; project only needs consecutive-failure counter + half-open, not bulkhead/timeout/fallback policies |

### Decision: Hand-roll retry cap + circuit breaker

**Rationale:**
1. The existing `RetryingProvider` already implements retry + exponential backoff -- only needs a max-retry cap and a circuit breaker state machine
2. cockatiel's policy-wrapping interface would require restructuring `RetryingProvider.call()` significantly
3. The circuit breaker spec is narrow: 3 states (CLOSED/OPEN/HALF_OPEN), consecutive failure counter, timer-based recovery
4. No new `npm install` required -- zero dependency change

## Architecture Patterns

### Recommended Project Structure
```
src/core/
  pipeline-loop.ts         # PipelineLoop: while-loop stage orchestration (EXEC-01)
  stage-executor.ts        # StageExecutor: single-stage execute + retry + gate (EXEC-03)
  fix-loop-runner.ts       # FixLoopRunner: Tester-Coder progressive fix loop (EXEC-02)
  retrying-provider.ts     # Enhanced: max retries + circuit breaker (EXEC-04)
  shutdown-coordinator.ts  # ShutdownCoordinator: graceful SIGINT/SIGTERM (EXEC-05)
  stage-outcome.ts         # StageOutcome discriminated union type (EXEC-01)
  __tests__/
    pipeline-loop.test.ts
    stage-executor.test.ts
    fix-loop-runner.test.ts
    retrying-provider.test.ts    # Existing, extend with circuit breaker tests
    shutdown-coordinator.test.ts
```

### Pattern 1: StageOutcome Discriminated Union (EXEC-01)

**What:** Replace recursive calls with a return-value-driven loop. Each stage execution returns a `StageOutcome` that the loop interprets.

**When to use:** Whenever a function's control flow involves "try again" or "go back" semantics.

**Design:**
```typescript
// src/core/stage-outcome.ts
export type StageOutcome =
  | { readonly type: 'done' }
  | { readonly type: 'skipped' }
  | { readonly type: 'retry'; readonly reason: string; readonly attempt: number }
  | { readonly type: 'rejected'; readonly feedback?: string; readonly comments?: ReviewComment[] }
  | { readonly type: 'failed'; readonly error: string; readonly retriesExhausted: boolean }
  | { readonly type: 'fix_loop'; readonly round: number; readonly approach: string };
```

The `PipelineLoop` interprets outcomes:
- `done` / `skipped` -> advance to next stage
- `retry` -> re-execute same stage (StageExecutor handles retry count)
- `rejected` -> re-execute with feedback injected
- `failed` (retriesExhausted) -> ask user or abort
- `fix_loop` -> delegate to FixLoopRunner

### Pattern 2: StageExecutor Single-Stage Unit (EXEC-03)

**What:** Encapsulates single-stage execution: build context, create agent, execute, handle clarification, check gate, return `StageOutcome`. No retry loop inside -- just one attempt.

**Why:** The current `executeStage()` mixes retry logic, gate handling, clarification, issue creation, snapshot, git commit, and evolution. StageExecutor isolates the "one attempt" path.

**Interface:**
```typescript
export class StageExecutor {
  constructor(
    private ctx: RunContext,
    private agentsConfig: AgentsConfig,
    private handler: InteractionHandler,
    private publisher?: GitPublisher,
  ) {}

  /** Execute one attempt of a stage. Returns outcome, never throws for expected failures. */
  async execute(run: PipelineRun, stage: StageName): Promise<StageOutcome> {
    // 1. Skip if done (resume)
    // 2. Transition to running
    // 3. Build context + create agent
    // 4. Execute agent (catch ClarificationNeeded)
    // 5. Commit artifacts
    // 6. Gate check (auto/manual)
    // 7. Snapshot + issue (non-blocking)
    // 8. Return StageOutcome
  }
}
```

### Pattern 3: PipelineLoop Orchestration (EXEC-01 + EXEC-03)

**What:** The top-level `while` loop that iterates through stages, interprets `StageOutcome`, and delegates to `FixLoopRunner` when needed.

```typescript
export class PipelineLoop {
  constructor(
    private executor: StageExecutor,
    private fixRunner: FixLoopRunner,
    private ctx: RunContext,
  ) {}

  async run(pipelineRun: PipelineRun, stages: readonly StageName[]): Promise<void> {
    let i = 0;
    while (i < stages.length) {
      const stage = stages[i];
      const outcome = await this.executor.execute(pipelineRun, stage);

      switch (outcome.type) {
        case 'done':
        case 'skipped':
          i++;
          break;
        case 'retry':
        case 'rejected':
          // Stay on same stage -- executor already incremented retryCount
          break;
        case 'fix_loop':
          await this.fixRunner.run(pipelineRun, stages);
          i++; // After fix loop completes, advance past tester
          break;
        case 'failed':
          if (outcome.retriesExhausted) {
            // Ask user: retry/skip/abort
            // ...
          }
          break;
      }

      this.savePipelineState(pipelineRun);
    }
  }
}
```

### Pattern 4: Circuit Breaker State Machine (EXEC-04)

**What:** Three-state machine (CLOSED -> OPEN -> HALF_OPEN -> CLOSED) embedded in `RetryingProvider`.

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;  // 5 consecutive failures -> OPEN
  recoveryMs: number;        // 30_000ms -> transition to HALF_OPEN
}

// Integrated into RetryingProvider:
// - CLOSED: normal operation, count consecutive failures
// - OPEN: all calls immediately throw CircuitOpenError
// - HALF_OPEN: allow one probe call; success -> CLOSED, failure -> OPEN
```

**Key detail:** The circuit breaker tracks consecutive failures, not total failures. A single success resets the counter to 0. This prevents the circuit from opening during intermittent rate-limit errors that eventually resolve.

### Pattern 5: ShutdownCoordinator (EXEC-05)

**What:** Singleton that registers SIGINT/SIGTERM handlers, sets a shutdown flag, and waits for the current stage to complete its artifact write.

**Integration with RunContext:** The `AbortSignal` in `RunContext` is the communication channel. When SIGINT fires, `ShutdownCoordinator` aborts the controller, and the pipeline loop checks `ctx.signal.aborted` between stages.

```typescript
export class ShutdownCoordinator {
  private controller: AbortController;
  private cleanupPromise: Promise<void> | null = null;

  constructor() {
    this.controller = new AbortController();
  }

  get signal(): AbortSignal { return this.controller.signal; }

  /** Register process signal handlers. Call once at startup. */
  install(): void {
    const handler = () => {
      if (this.controller.signal.aborted) {
        // Second signal -> force exit
        process.exit(1);
      }
      this.controller.abort();
      // Wait for cleanup, then exit
      if (this.cleanupPromise) {
        this.cleanupPromise.then(() => process.exit(0));
      }
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  /** Set the promise that must complete before exit. */
  setCleanup(p: Promise<void>): void {
    this.cleanupPromise = p;
  }
}
```

**Key detail:** Double-SIGINT forces immediate exit (standard Node.js convention). The cleanup promise is set by `StageExecutor` when an artifact write is in progress.

### Anti-Patterns to Avoid
- **Recursive retry:** `return this.executeStage(run, stage)` -- this is what we are eliminating. Stack depth is unbounded and control flow is implicit.
- **Index manipulation for fix loop:** `i = coderIdx - 1; continue;` in the main pipeline for-loop. This couples fix-loop logic to array indexing.
- **Duplicated fix loop code:** Currently identical fix-loop logic in both `run()` and `resumeRun()`. Extract once into `FixLoopRunner`.
- **Global signal handlers without cleanup:** Registering SIGINT handler that calls `process.exit()` immediately, orphaning partial artifact writes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential backoff | Custom delay calculation | Keep existing `RetryingProvider` backoff logic | Already correct with jitter |
| Event system | Custom pub/sub | `eventemitter3` via `EventBus` | Already integrated |
| State machine validation | Ad-hoc if/else chains | Keep existing `VALID_TRANSITIONS` map in `pipeline.ts` | Already correct, tested |

**Key insight:** This phase is about restructuring control flow, not introducing new infrastructure. The building blocks (RunContext, ArtifactStore, EventBus, Result, pipeline state machine) are all in place from Phase 2.

## Common Pitfalls

### Pitfall 1: Circuit Breaker Timer Leak
**What goes wrong:** Circuit breaker uses `setTimeout` for OPEN -> HALF_OPEN recovery, but the timer keeps the process alive after shutdown.
**Why it happens:** Node.js event loop waits for active timers.
**How to avoid:** Use `timer.unref()` so the recovery timer doesn't prevent process exit. Or clear the timer in `ShutdownCoordinator` cleanup.
**Warning signs:** Process hangs after pipeline completion or SIGINT.

### Pitfall 2: Signal Handler Double Registration
**What goes wrong:** If `ShutdownCoordinator.install()` is called multiple times (e.g., in tests or when creating multiple orchestrator instances), handlers stack up.
**Why it happens:** `process.on('SIGINT', ...)` adds a new listener each time.
**How to avoid:** Track registration state with a boolean flag. In tests, provide a mock or use `AbortController` directly without process signals.
**Warning signs:** MaxListenersExceededWarning in test output.

### Pitfall 3: AbortSignal Not Checked Between Stages
**What goes wrong:** SIGINT fires but the pipeline loop doesn't check `ctx.signal.aborted` before starting the next stage, so it begins a new LLM call.
**Why it happens:** The abort signal only prevents new operations if code actively checks it.
**How to avoid:** Check `ctx.signal.aborted` at the top of the `while` loop and before each `executor.execute()` call.
**Warning signs:** Pipeline starts new LLM calls after Ctrl+C.

### Pitfall 4: Fix Loop State Not Persisted on Crash
**What goes wrong:** Pipeline crashes mid-fix-loop, resume restarts from scratch because `fixLoopRound` wasn't saved.
**Why it happens:** Current code saves `fixLoopRound` in `pipeline-state.json` but only after successful stage completion.
**How to avoid:** `FixLoopRunner` saves state at the start of each round, not just at the end. The existing `SavedPipelineState.fixLoopRound` field already exists.
**Warning signs:** Resume after crash during fix loop starts coder from scratch instead of continuing at the correct round.

### Pitfall 5: StageOutcome vs Exception Boundary Confusion
**What goes wrong:** Some errors should be StageOutcome (retryable failures), others should throw (programmer errors, config errors). Mixing them up causes silent failures or unnecessary retries.
**Why it happens:** No clear boundary definition.
**How to avoid:** Rule: `StageOutcome.failed` for any error that occurred during agent execution (LLM errors, artifact parse failures). Throw exceptions for programming errors (`TypeError`, assertion failures), config errors (missing stage in pipeline.yaml), and shutdown signals.
**Warning signs:** Retrying on TypeError, or getting StageOutcome for missing config files.

### Pitfall 6: RetryingProvider `instanceof` Check Breaks
**What goes wrong:** Line 451 of orchestrator.ts does `if (ctx.provider instanceof RetryingProvider)` to call `setContext()`. If the provider chain changes (e.g., wrapped in another decorator), this check fails silently.
**Why it happens:** `instanceof` is fragile across decorator chains.
**How to avoid:** Use a method check (`'setContext' in ctx.provider`) or make `setContext` part of the `LLMProvider` interface (as a no-op default).
**Warning signs:** Retry log shows empty runId/stage fields.

## Code Examples

### Current Recursion Sites (to eliminate)

Three recursive calls in `orchestrator.ts`:

```typescript
// Line 545: Retry after rejection
return this.executeStage(run, stage);

// Line 597: Retry after failure (within retry_max)
return this.executeStage(run, stage);

// Line 612: Manual retry after exhaustion
return this.executeStage(run, stage);
```

### Current Fix Loop (duplicated in run() and resumeRun())

```typescript
// Lines 151-203 (run) and 332-375 (resumeRun) -- nearly identical
if (stage === 'tester' && testerCoderFixCount < MAX_FIX_ROUNDS) {
  const shouldRetry = this.checkTesterVerdict();
  if (shouldRetry) {
    // ... progressive strategy selection ...
    const coderIdx = pipelineStages.indexOf('coder');
    if (coderIdx !== -1) {
      i = coderIdx - 1;  // Index manipulation
      continue;
    }
  }
}
```

### Circuit Breaker Implementation Sketch

```typescript
// Integrated into retrying-provider.ts
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const CIRCUIT_DEFAULTS = {
  failureThreshold: 5,
  recoveryMs: 30_000,
};

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryMs: number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`Circuit breaker is OPEN. Recovery in ${Math.ceil(remainingMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

// Inside RetryingProvider:
private circuitState: CircuitState = 'CLOSED';
private consecutiveFailures = 0;
private openedAt = 0;
private recoveryTimer?: ReturnType<typeof setTimeout>;

private checkCircuit(): void {
  if (this.circuitState === 'OPEN') {
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= this.circuitConfig.recoveryMs) {
      this.circuitState = 'HALF_OPEN';
    } else {
      throw new CircuitOpenError(this.circuitConfig.recoveryMs - elapsed);
    }
  }
}

private recordSuccess(): void {
  this.consecutiveFailures = 0;
  if (this.circuitState === 'HALF_OPEN') {
    this.circuitState = 'CLOSED';
  }
}

private recordFailure(): void {
  this.consecutiveFailures++;
  if (this.consecutiveFailures >= this.circuitConfig.failureThreshold) {
    this.circuitState = 'OPEN';
    this.openedAt = Date.now();
  }
}
```

### FixLoopRunner Progressive Strategy

```typescript
// src/core/fix-loop-runner.ts
export interface FixLoopConfig {
  maxRounds: number;       // 5
  replanThreshold: number; // 3
}

export class FixLoopRunner {
  constructor(
    private executor: StageExecutor,
    private ctx: RunContext,
    private config: FixLoopConfig = { maxRounds: 5, replanThreshold: 3 },
  ) {}

  async run(
    pipelineRun: PipelineRun,
    stages: readonly StageName[],
    startRound = 0,
  ): Promise<void> {
    let round = startRound;

    while (round < this.config.maxRounds) {
      const shouldRetry = this.checkTesterVerdict();
      if (!shouldRetry) return; // Tests passed

      round++;
      const approach = this.selectApproach(round);

      this.ctx.logger.pipeline('info', 'fix-loop:round', { round, approach });
      this.ctx.eventBus.emit('coder:fix-round', round, 0, 0, approach);

      // Reset coder + tester states
      pipelineRun.stages['coder'] = { state: 'idle', retryCount: 0 };
      pipelineRun.stages['tester'] = { state: 'idle', retryCount: 0 };

      // Re-run coder then tester
      await this.executor.execute(pipelineRun, 'coder');
      await this.executor.execute(pipelineRun, 'tester');
    }
  }

  private selectApproach(round: number): string {
    if (round < this.config.replanThreshold) return 'direct-fix';
    if (round === this.config.replanThreshold) return 'replan-failed-modules';
    return 'full-history-fix';
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recursive executeStage | Iterative while loop + StageOutcome | This phase | Eliminates unbounded stack, centralizes control |
| Infinite retries in RetryingProvider | Max 20 retries + circuit breaker | This phase | Prevents infinite LLM retry burn |
| No graceful shutdown | ShutdownCoordinator with artifact-safe exit | This phase | No partial artifacts on SIGINT |
| Fix loop embedded in orchestrator | Independent FixLoopRunner | This phase | Testable in isolation, no code duplication |

## Open Questions

1. **Resume state file migration**
   - What we know: `SavedPipelineState` has no version field. Future format changes could break resume.
   - What's unclear: Whether to add a version field now or defer.
   - Recommendation: Add `version: 1` field to `SavedPipelineState`. On load, check version -- if missing or older, log a warning and invalidate (reset all non-done stages). Low cost to add now, prevents future migration headaches.

2. **EventBus event sequence contract**
   - What we know: Events are emitted in orchestrator at specific points (stage:start, stage:complete, etc.), but the expected sequence isn't documented or tested.
   - What's unclear: Which event orderings are contractual vs incidental.
   - Recommendation: Capture the expected event sequence as a test fixture in `pipeline-loop.test.ts` -- run a 3-stage pipeline with mocks and assert the event emission order. This validates the new PipelineLoop emits in the same order as the old orchestrator.

3. **RetryingProvider `setContext` pattern**
   - What we know: Orchestrator uses `instanceof RetryingProvider` check to call `setContext()`. This is fragile.
   - What's unclear: Whether to add `setContext` to `LLMProvider` interface or use duck typing.
   - Recommendation: Add optional `setContext?(runId: string, stage: StageName): void` to `LLMProvider` interface. Providers that don't need it simply don't implement it. StageExecutor calls `ctx.provider.setContext?.(...)`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | PipelineLoop iterates stages via while loop, interprets StageOutcome | unit + integration | `npx vitest run src/core/__tests__/pipeline-loop.test.ts -x` | Wave 0 |
| EXEC-02 | FixLoopRunner runs progressive strategy independently | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | Wave 0 |
| EXEC-03 | StageExecutor handles single-stage execute + retry + gate | unit | `npx vitest run src/core/__tests__/stage-executor.test.ts -x` | Wave 0 |
| EXEC-04 | RetryingProvider max 20 retries + circuit breaker 5-fail/30s | unit | `npx vitest run src/core/__tests__/retrying-provider.test.ts -x` | Wave 0 |
| EXEC-05 | ShutdownCoordinator completes artifact write on SIGINT | unit | `npx vitest run src/core/__tests__/shutdown-coordinator.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/core/__tests__/{changed-module}.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/__tests__/pipeline-loop.test.ts` -- covers EXEC-01
- [ ] `src/core/__tests__/fix-loop-runner.test.ts` -- covers EXEC-02
- [ ] `src/core/__tests__/stage-executor.test.ts` -- covers EXEC-03
- [ ] `src/core/__tests__/retrying-provider.test.ts` -- extend existing (if any) with circuit breaker tests for EXEC-04
- [ ] `src/core/__tests__/shutdown-coordinator.test.ts` -- covers EXEC-05

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/core/orchestrator.ts` -- all recursion sites, fix loop code, gate handling
- Codebase inspection: `src/core/retrying-provider.ts` -- current retry logic, `maxRetries: Infinity` default
- Codebase inspection: `src/core/run-context.ts` -- RunContext with AbortSignal
- Codebase inspection: `src/core/pipeline.ts` -- state machine transitions
- Codebase inspection: `src/core/event-bus.ts` -- PipelineEvents type
- Codebase inspection: `src/core/resume.ts` -- SavedPipelineState, fixLoopRound field
- Codebase inspection: `src/core/result.ts` -- Result<T,E> discriminated union
- Codebase inspection: `src/core/retry-log.ts` -- retry logging infrastructure

### Secondary (MEDIUM confidence)
- npm registry: cockatiel 3.2.1, last published 2024-07-22, supports ESM via `module` field
- Node.js docs: `process.on('SIGINT', ...)`, `AbortController`, `timer.unref()`

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing infrastructure
- Architecture: HIGH - direct codebase analysis, clear decomposition from existing monolithic orchestrator
- Pitfalls: HIGH - derived from reading actual code (recursion, signal handling, timer leaks are well-understood Node.js patterns)

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable infrastructure patterns, no external dependency drift risk)
