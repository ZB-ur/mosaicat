# Technology Stack: Core Engine Rewrite Patterns

**Project:** Mosaicat v2 Core Engine Rewrite
**Researched:** 2026-03-26
**Focus:** Patterns and approaches for rewriting ~70% of an existing TypeScript multi-agent pipeline orchestration engine

## Recommended Patterns & Libraries

### 1. Error Handling: Lightweight Result Type (NOT Effect-TS)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom `Result<T, E>` type | N/A | Typed error returns for all engine operations | Minimal overhead, no dependency, fits existing codebase style |

**Rationale:** Effect-TS is powerful but overkill for this project. It would force a paradigm shift across the entire codebase (pipe-based composition, Effect monad everywhere) that conflicts with the constraint of incremental rewrite and compatibility with preserved modules. neverthrow is no longer actively maintained (PRs stalled for months). A custom 50-line Result type gives us what we need: explicit error types in function signatures, no silent catch blocks.

**Confidence:** HIGH (multiple sources confirm neverthrow maintenance status; Effect-TS learning curve well-documented)

**Implementation:**

```typescript
// src/core/result.ts — the entire file
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function fromTryCatch<T, E = Error>(
  fn: () => T,
  mapError?: (e: unknown) => E
): Result<T, E> {
  try {
    return Ok(fn());
  } catch (e) {
    return Err((mapError ? mapError(e) : e) as E);
  }
}

export async function fromPromise<T, E = Error>(
  promise: Promise<T>,
  mapError?: (e: unknown) => E
): Promise<Result<T, E>> {
  try {
    return Ok(await promise);
  } catch (e) {
    return Err((mapError ? mapError(e) : e) as E);
  }
}
```

**Usage pattern across the rewrite:**

```typescript
// Before (current — silent catch)
try {
  const manifest = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return validateManifest(manifest);
} catch {
  return []; // silent failure, bugs hide here
}

// After (rewrite — explicit error)
function readManifest(path: string): Result<Manifest, ManifestError> {
  const raw = fromTryCatch(
    () => fs.readFileSync(path, 'utf-8'),
    () => ({ type: 'unreadable' as const, path })
  );
  if (!raw.ok) return raw;

  const parsed = fromTryCatch(
    () => JSON.parse(raw.value),
    () => ({ type: 'malformed_json' as const, path })
  );
  if (!parsed.ok) return parsed;

  const validated = manifestSchema.safeParse(parsed.value);
  if (!validated.success) {
    return Err({ type: 'invalid_schema' as const, path, issues: validated.error.issues });
  }
  return Ok(validated.data);
}
```

**What NOT to do:**
- Do NOT adopt Effect-TS. The pipe-based functional style would require rewriting ALL modules including frozen ones to maintain consistency. The learning curve for contributors is steep.
- Do NOT use neverthrow. It's unmaintained and the maintenance status adds supply-chain risk for a core engine dependency.
- Do NOT keep bare `catch {}` blocks. Every catch must either return a Result error or log + return a typed fallback.

---

### 2. State Management: Iterative Loop with Typed Stage Context (NOT XState)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Iterative `while` loop | N/A | Replace recursive `executeStage` | Eliminates stack overflow, simpler debugging |
| Discriminated union for stage outcomes | N/A | Type-safe stage result handling | Forces exhaustive handling of all outcomes |

**Rationale:** XState v5 is excellent for UI state management and complex statecharts, but Mosaicat already has a working state machine in `pipeline.ts` (FROZEN). The problem is not the state machine — it is the orchestrator's recursive execution pattern and mutable config injection. XState would require rewriting the frozen `pipeline.ts` module and adding a ~15KB dependency for something achievable with a `while` loop and discriminated unions.

**Confidence:** HIGH (the existing pipeline.ts state machine is proven; the recursive execution is the documented problem)

**Implementation:**

```typescript
// Discriminated union for stage outcomes
type StageOutcome =
  | { type: 'completed'; artifacts: string[] }
  | { type: 'clarification_resolved'; answer: string }
  | { type: 'rejected'; feedback: string; retryCount: number }
  | { type: 'failed'; error: Error; retryable: boolean }
  | { type: 'skipped'; reason: string };

// Iterative execution loop (replaces recursive executeStage)
async executeStages(run: PipelineRun, stages: StageName[]): Promise<PipelineRun> {
  let stageIndex = 0;

  while (stageIndex < stages.length) {
    const stage = stages[stageIndex];
    const outcome = await this.executeStage(run, stage);

    switch (outcome.type) {
      case 'completed':
        stageIndex++;
        break;

      case 'rejected': {
        if (outcome.retryCount >= this.maxRetries(stage)) {
          throw new StageExhaustedError(stage, outcome.retryCount);
        }
        // Stay on same stageIndex — retry
        break;
      }

      case 'failed': {
        if (!outcome.retryable) throw outcome.error;
        // Stay on same stageIndex — retry
        break;
      }

      case 'skipped':
        stageIndex++;
        break;
    }
  }
  return run;
}
```

**Tester-Coder fix loop as a dedicated method:**

```typescript
// Extract from main loop — no more index manipulation
async executeCoderTesterFixLoop(
  run: PipelineRun,
  maxFixAttempts: number = 3
): Promise<StageOutcome> {
  for (let attempt = 0; attempt < maxFixAttempts; attempt++) {
    const coderResult = await this.executeStage(run, 'coder');
    if (!coderResult.ok) return coderResult;

    const testerResult = await this.executeStage(run, 'tester');
    if (testerResult.type === 'completed') return testerResult;

    // Inject test failures for next coder iteration
    this.prepareCoderRetry(run, testerResult);
  }
  return { type: 'failed', error: new Error('Fix loop exhausted'), retryable: false };
}
```

**What NOT to do:**
- Do NOT introduce XState for the orchestration loop. It solves a different problem (complex statecharts with parallel regions) and the existing `pipeline.ts` state machine works.
- Do NOT manipulate loop indices. Extract sub-loops into dedicated methods with their own iteration.
- Do NOT mutate shared config objects. Clone before mutate, always.

---

### 3. Artifact Store: Class Instance Per Run (NOT global module state)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ArtifactStore` class | N/A | Per-run artifact I/O scoped by instance | Eliminates global mutable state, enables test isolation, future concurrency |

**Rationale:** The current `artifact.ts` uses module-level `currentRunDir` — a textbook global mutable state problem. The fix is straightforward: wrap it in a class, instantiate per run, pass through context.

**Confidence:** HIGH (this is standard OOP encapsulation, not experimental)

**Implementation:**

```typescript
// src/core/artifact-store.ts
export class ArtifactStore {
  private readonly runDir: string;

  constructor(baseDir: string, runId: string) {
    this.runDir = path.join(baseDir, runId);
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  get dir(): string { return this.runDir; }

  write(name: string, content: string): void {
    const filePath = path.join(this.runDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  read(name: string): Result<string, ArtifactError> {
    return fromTryCatch(
      () => fs.readFileSync(path.join(this.runDir, name), 'utf-8'),
      () => ({ type: 'not_found' as const, name, runDir: this.runDir })
    );
  }

  exists(name: string): boolean {
    return fs.existsSync(path.join(this.runDir, name));
  }
}
```

**Backward compatibility:** Keep the old `artifact.ts` functions as thin wrappers that delegate to a module-level default store during migration. This lets frozen modules continue working.

---

### 4. Dependency Wiring: Constructor Injection with Context Object (NOT a DI framework)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Plain constructor injection | N/A | Pass dependencies explicitly | Zero overhead, full type safety, no decorators, no reflect-metadata |

**Rationale:** tsyringe requires decorators and reflect-metadata polyfills. InversifyJS is heavy. typed-inject is clever but adds cognitive overhead for a project of this size (~15K lines). The codebase already uses constructor injection in several places. Formalizing a `RunContext` object that flows through the pipeline gives us DI benefits without framework overhead.

**Confidence:** HIGH (the project is not large enough for a DI container to pay for itself)

**Implementation:**

```typescript
// src/core/run-context.ts
export interface RunContext {
  readonly runId: string;
  readonly artifacts: ArtifactStore;
  readonly provider: LLMProvider;
  readonly logger: Logger;
  readonly handler: InteractionHandler;
  readonly config: Readonly<PipelineConfig>;
  readonly agentsConfig: Readonly<AgentsConfig>;
}

// Orchestrator creates the context once, passes it down
const ctx: RunContext = {
  runId,
  artifacts: new ArtifactStore('.mosaic/artifacts', runId),
  provider: createRetryingProvider(providerConfig),
  logger: new Logger(runId),
  handler: this.handler,
  config: structuredClone(this.pipelineConfig), // clone, never mutate original
  agentsConfig: structuredClone(this.agentsConfig),
};

// Agents receive context, not individual dependencies
class CoderPlanner {
  constructor(private readonly ctx: RunContext) {}
}
```

**What NOT to do:**
- Do NOT add tsyringe, InversifyJS, or any DI container. The project has ~13 agents and ~6 core modules — manual wiring is completely manageable.
- Do NOT pass dependencies as separate constructor params (current pattern leads to 5+ params). Use a single context object.
- Do NOT mutate config after context creation. The `structuredClone` at creation time prevents the mutable config bug.

---

### 5. Resilience: Cockatiel for Retry + Circuit Breaker

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `cockatiel` | ^3.2 | Retry with backoff + circuit breaker + timeout policies | Battle-tested, composable policies, TypeScript-native, zero-dep |

**Rationale:** The current `RetryingProvider` has `maxRetries: Infinity` by default and no circuit breaker. Cockatiel provides composable resilience policies (retry, circuit breaker, timeout, bulkhead) that can be wrapped around any async operation. It is MIT-licensed, actively maintained (by a VS Code team member at Microsoft), TypeScript-first, and has zero dependencies.

**Confidence:** MEDIUM (cockatiel is well-documented but I haven't verified the exact latest version via official source; the pattern is solid regardless of whether you use the library or hand-roll it)

**Implementation:**

```typescript
import { retry, circuitBreaker, wrap, handleAll, ExponentialBackoff } from 'cockatiel';

// Compose policies
const retryPolicy = retry(handleAll, {
  maxAttempts: 20,
  backoff: new ExponentialBackoff({
    initialDelay: 1000,
    maxDelay: 60_000,
  }),
});

const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 30_000,    // try again after 30s
  breaker: new ConsecutiveBreaker(5), // open after 5 consecutive failures
});

// Wrap: retry first, then circuit breaker
const resilientCall = wrap(retryPolicy, breakerPolicy);

// Use in provider
async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
  return resilientCall.execute(() => this.inner.call(prompt, options));
}
```

**Alternative:** If adding a dependency feels wrong, keep the hand-rolled retry but add: (1) finite default `maxRetries: 20`, (2) total elapsed time circuit breaker (`Date.now() - startTime > maxTotalMs`), (3) log via logger instead of `console.warn`.

---

### 6. Testing Strategy for Async Pipelines

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vitest (existing) | ^4.1 | Test runner | Already in stack, no reason to change |
| Typed mock factories | N/A | Replace `as any` casts | Type-safe test setup, catches regressions |
| Integration test harness | N/A | Test resume, fix loops, stage transitions | Cover the critical paths that currently have zero tests |

**Confidence:** HIGH (Vitest is already in use; the patterns are well-established)

**Pattern 1: Typed mock factories (eliminate `as any`)**

```typescript
// src/__tests__/test-factories.ts
import type { LLMProvider, LLMResponse } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { RunContext } from '../core/run-context.js';
import { ArtifactStore } from '../core/artifact-store.js';

export function createMockProvider(overrides?: Partial<LLMProvider>): LLMProvider {
  return {
    call: vi.fn().mockResolvedValue({ text: '', usage: { inputTokens: 0, outputTokens: 0 } }),
    ...overrides,
  };
}

export function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(),
  } as unknown as Logger;
}

export function createTestContext(overrides?: Partial<RunContext>): RunContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaicat-test-'));
  return {
    runId: 'test-run',
    artifacts: new ArtifactStore(tmpDir, 'test-run'),
    provider: createMockProvider(),
    logger: createMockLogger(),
    handler: createMockHandler(),
    config: loadTestPipelineConfig(),
    agentsConfig: loadTestAgentsConfig(),
    ...overrides,
  };
}
```

**Pattern 2: Integration tests for async pipeline flows**

```typescript
// Test the iterative loop, not individual stages
describe('Orchestrator stage execution', () => {
  it('retries rejected stage up to maxRetries then fails', async () => {
    const ctx = createTestContext({
      provider: createMockProvider({
        call: vi.fn()
          .mockResolvedValueOnce(rejectedOutput())
          .mockResolvedValueOnce(rejectedOutput())
          .mockResolvedValueOnce(approvedOutput()),
      }),
    });

    const result = await orchestrator.executeStages(ctx, ['product_owner']);
    expect(result.stages.product_owner?.retryCount).toBe(2);
    expect(result.stages.product_owner?.state).toBe('done');
  });

  it('coder-tester fix loop exhausts after maxFixAttempts', async () => {
    // ...
  });
});
```

**Pattern 3: Filesystem-based integration tests for resume**

```typescript
describe('Resume flow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaicat-resume-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resumes from last completed stage', async () => {
    // Write a partial pipeline-state.json
    // Write some artifacts
    // Call resumeRun()
    // Assert it starts from the correct stage
  });
});
```

---

### 7. Graceful Shutdown

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `AbortController` (Node.js built-in) | N/A | Signal cancellation through the pipeline | Standard API, no dependencies, works with async/await |

**Confidence:** HIGH (AbortController is stable Node.js API since v15)

**Implementation:**

```typescript
// In CLI entry point
const controller = new AbortController();

process.on('SIGINT', () => {
  console.log('\nGraceful shutdown: finishing current stage...');
  controller.abort();
});

process.on('SIGTERM', () => {
  controller.abort();
});

// Pass signal through RunContext
interface RunContext {
  // ... existing fields
  readonly signal: AbortSignal;
}

// Check in orchestrator loop
while (stageIndex < stages.length) {
  if (ctx.signal.aborted) {
    await this.saveState(run); // persist current state
    break; // exit cleanly
  }
  // ... execute stage
}
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Error handling | Custom Result type | Effect-TS | Paradigm shift incompatible with incremental rewrite; steep learning curve |
| Error handling | Custom Result type | neverthrow | Unmaintained (PRs stalled months); supply-chain risk for core engine |
| State management | Iterative loop + discriminated unions | XState v5 | Existing pipeline.ts state machine works; XState solves a different problem |
| DI | Constructor injection + RunContext | tsyringe | Requires decorators + reflect-metadata; overkill for ~13 agents |
| DI | Constructor injection + RunContext | InversifyJS | Heavy, enterprise-grade; project is 15K lines not 150K |
| Resilience | cockatiel | Hand-rolled retry | Current hand-rolled version has Infinity default and no circuit breaker |
| Resilience | cockatiel | @carbonteq/resilience | Less mature, smaller community |
| Testing | Typed mock factories | No change | Current `as any` pattern hides type regressions |

---

## What Stays (No Changes Needed)

| Technology | Version | Why Keep |
|------------|---------|----------|
| TypeScript | ^5.9 | Already using strict mode, NodeNext module resolution |
| Vitest | ^4.1 | Solid, fast, works well with ESM |
| Zod | ^4.3 | Already used for all artifact validation |
| p-queue | ^9.1 | Still needed for Claude CLI serial execution |
| eventemitter3 | ^5.0 | Event bus is frozen, works fine |
| @anthropic-ai/sdk | ^0.78 | Direct API provider, stable |
| Playwright | ^1.58 | Screenshot rendering is frozen |

---

## Installation

```bash
# Only new dependency (optional — can hand-roll instead)
npm install cockatiel

# No other new dependencies needed — all patterns use:
# - TypeScript built-in types (Result, discriminated unions)
# - Node.js built-in APIs (AbortController, fs, path)
# - Existing dependencies (Vitest, Zod)
```

---

## Summary: What Changes in the Rewrite

| Before (v1) | After (v2) | Pattern |
|---|---|---|
| Silent `catch {}` (16+ instances) | `Result<T, E>` returns with typed errors | Custom Result type |
| Recursive `executeStage()` | Iterative `while` loop with `StageOutcome` union | Discriminated union |
| Loop index manipulation for fix loop | `executeCoderTesterFixLoop()` method | Extract method |
| Module-level `currentRunDir` global | `ArtifactStore` class per run | Instance scoping |
| 5+ constructor params | Single `RunContext` object | Context object pattern |
| `maxRetries: Infinity` | Finite retry (20) + circuit breaker + total time limit | cockatiel or enhanced hand-roll |
| No shutdown handling | `AbortController` signal through context | Node.js built-in |
| `as any` in 6 test files | Typed mock factories | `createTestContext()` |
| `console.warn` in retry | Logger integration | Unified logging |
| Mutable config injection | `structuredClone` at context creation | Clone-before-mutate |

---

## Sources

- [Cockatiel: resilience library for TypeScript](https://github.com/connor4312/cockatiel) — Retry, circuit breaker, timeout policies
- [Effect-TS Documentation](https://effect.website/) — Evaluated and rejected for this project
- [neverthrow GitHub](https://github.com/supermacro/neverthrow) — Evaluated; maintenance concerns
- [XState v5](https://stately.ai/docs/xstate) — Evaluated; not needed given existing pipeline.ts
- [TypeScript Orchestration Guide](https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d) — Ecosystem overview
- [typed-inject](https://www.npmjs.com/package/typed-inject) — DI alternative evaluated
- [tsyringe](https://github.com/microsoft/tsyringe) — DI alternative evaluated
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking) — Testing patterns
- [DI Benchmark: Vanilla vs frameworks](https://blog.vady.dev/di-benchmark-vanilla-registrycomposer-typed-inject-tsyringe-inversify-nestjs) — Performance comparison showing vanilla is 3x faster

---

*Stack research: 2026-03-26*
