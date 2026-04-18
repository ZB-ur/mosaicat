# Architecture Research

**Domain:** Quality gate enforcement & cost optimization for multi-agent pipeline
**Researched:** 2026-03-28
**Confidence:** HIGH (based on direct codebase analysis of shipped v1.0 architecture)

## Current Architecture Recap

```
Orchestrator (208 lines, thin facade)
    ├── initRunContext() → RunContext { store, logger, provider, eventBus, config, signal }
    ├── runIntentConsultant() → IntentConsultantAgent
    └── executePipeline() → PipelineLoop
                                ├── StageExecutor.execute(run, stage) → StageOutcome
                                │       ├── buildContext() → AgentContext
                                │       ├── createAgent() → BaseAgent/LLMAgent
                                │       ├── agent.execute(context) → artifacts + manifest on disk
                                │       ├── gate check (auto/manual) → approved/rejected
                                │       └── checkTesterVerdict() → fix_loop trigger
                                │
                                └── FixLoopRunner.run()
                                        ├── checkTesterFailed() via manifest
                                        ├── selectApproach(round) → direct-fix/replan/full-history
                                        └── re-execute coder + tester stages
```

### Key Architectural Invariants (v1.0)

1. **StageOutcome discriminated union** drives all control flow (`done | skipped | retry | rejected | failed | fix_loop`)
2. **RunContext** is the single DI container -- immutable, threaded through everything
3. **ArtifactStore** is the sole inter-agent communication channel (disk-based)
4. **BaseAgent hooks** (pre/post) exist but are unused in production agents
5. **LLMResponse.usage** is already defined (`{ inputTokens, outputTokens }`) but not tracked/aggregated
6. **Manifest schemas** (Zod) validate structure at write time but not content truthfulness
7. **retry-log.ts** classifies errors into 9 categories but lacks smart routing
8. **RetryingProvider** already uses decorator pattern with circuit breaker

## New Components

### 1. QualityGate (NEW -- `src/core/quality-gate.ts`)

**What:** Post-agent content validator that runs after `agent.execute()` completes, before gate check.
**Integration point:** StageExecutor, between agent execution (line ~66) and gate check (line ~69).

```
StageExecutor.execute()
    ├── buildContext()
    ├── executeAgent()          ← agent writes artifacts + manifest
    ├── QualityGate.check()     ← NEW: content validation
    ├── gate check (auto/manual)
    └── snapshot
```

**Responsibilities:**
- Per-stage content validation rules (not just schema -- actual content quality)
- Manifest vs artifact cross-check (do `code.manifest.json` file paths exist on disk?)
- Stub/placeholder detection (regex patterns for TODO, placeholder, NotImplementedError)
- Feature coverage truthfulness (do claimed `covers_features` actually reference PRD features?)

**Interface:**

```typescript
interface QualityCheckResult {
  passed: boolean;
  violations: QualityViolation[];
  warnings: QualityWarning[];
}

interface QualityViolation {
  rule: string;           // e.g. 'no-placeholder-components', 'manifest-file-exists'
  severity: 'block' | 'warn';
  message: string;
  artifact?: string;      // which file failed
}

interface QualityGate {
  check(stage: StageName, store: ArtifactStore): QualityCheckResult;
}
```

**Design decision:** Pure function over the artifact store, no LLM calls. Quality gate must be deterministic and fast. LLM-based content review is the Reviewer/Validator agent's job -- quality gate catches mechanical failures.

**StageOutcome impact:** When quality gate fails with blocking violations, StageExecutor returns `{ type: 'retry', reason: violationSummary }` -- reuses existing retry flow. Violations are injected into agent context for the next attempt via `store.write('quality-violations.json', ...)`. **No new StageOutcome variant needed.**

### 2. TokenTracker + TokenTrackingProvider (NEW -- `src/core/token-tracker.ts`)

**What:** Accumulates `LLMResponse.usage` data per stage and per run.
**Integration point:** Wraps the provider chain using the existing decorator pattern.

```
RunContext.provider chain:
    TokenTrackingProvider (NEW: intercepts usage from responses)
        └── RetryingProvider (circuit breaker + retry)
            └── actual provider (ClaudeCLI / AnthropicSDK / OpenAI)
```

**Responsibilities:**
- Intercept every LLMResponse and accumulate `inputTokens + outputTokens`
- Track per-stage and per-run totals
- Emit `token:usage` events for CLI progress display
- Write `token-usage.json` to ArtifactStore at pipeline completion
- Provide current totals for budget-aware agents (Coder already uses `max_budget_usd`)

**Interface:**

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

class TokenTracker {
  recordUsage(stage: StageName, usage: { inputTokens: number; outputTokens: number }): void;
  getStageUsage(stage: StageName): TokenUsage;
  getRunUsage(): TokenUsage;
  getEstimatedCostUsd(): number;
  toJSON(): Record<string, TokenUsage>;  // for serialization
}

class TokenTrackingProvider implements LLMProvider {
  constructor(inner: LLMProvider, tracker: TokenTracker, eventBus: EventBus);
  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;
  // Delegates to inner, records usage from response, emits event
}
```

**Provider chain order rationale:** TokenTrackingProvider wraps RetryingProvider (sits outside). This means every call -- including retried calls -- gets tracked. We want to know total cost, not just successful-call cost.

**RunContext impact:** Add `readonly tokenTracker: TokenTracker` to RunContext interface. One field addition.

### 3. PlaceholderDetector (NEW -- `src/core/placeholder-detector.ts`)

**What:** Pure function that scans file content for stub/placeholder patterns.
**Integration point:** Called by QualityGate as one of its check rules.

```typescript
interface PlaceholderMatch {
  pattern: string;     // which pattern matched
  line: number;
  context: string;     // surrounding text
}

function detectPlaceholders(content: string, fileType: string): PlaceholderMatch[];
```

**Patterns to detect:**
- `// TODO`, `/* TODO */`, `// FIXME`, `// PLACEHOLDER`
- `throw new Error('Not implemented')`, `NotImplementedError`
- `placeholder`, `stub`, `dummy` in function/component bodies (not comments)
- Empty function bodies: `() => {}`, `async () => {}`
- Hardcoded fake data: `'lorem ipsum'`, `'test@test.com'` in production code

**Design decision:** Separate module from QualityGate because placeholder detection is reusable (Validator agent could also call it for content spot-checking).

### 4. ManifestContentValidator (NEW -- `src/core/manifest-validator.ts`)

**What:** Cross-references manifest claims against actual artifact content on disk.
**Integration point:** Called by QualityGate as one of its check rules.

**Key validations per manifest:**

| Manifest | Validation |
|----------|-----------|
| `code.manifest.json` | Every `files[].path` exists on disk. No files contain only stubs (via PlaceholderDetector). `covers_features` IDs exist in prd.manifest. |
| `components.manifest.json` | Every `components[].file` exists. `screenshots[]` files exist and are non-empty (>1KB). |
| `test-plan.manifest.json` | Every `test_suites[].test_file` path is syntactically valid. No `.ts`/`.tsx` extension confusion (the exact bug from run-1774640936546). |
| `test-report.manifest.json` | `total === passed + failed + skipped` (arithmetic check). `failures[].test_file` paths exist. |

**Why separate from manifest.ts:** `manifest.ts` validates schema structure (Zod parse). ManifestContentValidator validates semantic truthfulness against disk state. Different concerns, different modules.

### 5. Enhanced ErrorClassifier (MODIFIED -- `src/core/retry-log.ts`)

**What:** Upgrade existing `classifyError()` to provide actionable routing hints.
**Integration point:** Same file, extended return type.

**Current state:** `classifyError(raw: string): ErrorCategory` -- 9 categories, pure regex.

**Enhancement:**

```typescript
interface ClassifiedError {
  category: ErrorCategory;
  rootCause: string;          // human-readable root cause
  suggestedAction: 'retry' | 'replan' | 'skip' | 'abort' | 'fix-config';
  affectedFiles?: string[];   // extracted from error message
}

function classifyErrorDetailed(raw: string, stage: StageName): ClassifiedError;
```

**Routing heuristics:**
- `import-error` at coder stage + repeated same file → `suggestedAction: 'replan'`
- `test-failure` at tester + all tests crash (0 passed) → `suggestedAction: 'fix-config'`
- `rate-limit` or `timeout` → `suggestedAction: 'retry'`
- `type-error` at coder → `suggestedAction: 'retry'` (auto-fix usually works)
- Same error repeated 3+ times → escalate to next action level

**FixLoopRunner integration:** Replaces round-number heuristic for approach selection. Instead of "round 3 = replan", the classifier analyzes the actual failure and suggests the approach.

### 6. StageMetrics (NEW -- `src/core/stage-metrics.ts`)

**What:** Collects per-stage timing, token usage, and quality results.
**Integration point:** Populated by StageExecutor, accumulated by PipelineLoop, written by Orchestrator.

```typescript
interface StageMetric {
  stage: StageName;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokenUsage: TokenUsage;
  qualityResult?: QualityCheckResult;
  retryCount: number;
  outcome: StageOutcome['type'];
}

// Written as stage-metrics.json at pipeline completion
```

## Modified Components Summary

### StageExecutor (MODIFIED)

| Change | Detail |
|--------|--------|
| Constructor | Add `qualityGate: QualityGate` parameter |
| After executeAgent | Call `qualityGate.check(stage, store)` |
| Quality failure | Inject violations via store, return `{ type: 'retry' }` |
| Timing | Record stage start timestamp for StageMetrics |
| Error handling | Use `classifyErrorDetailed()` for richer retry logging |

```typescript
// Integration point: after line 66 (executeAgent), before line 69 (gate check)
const qualityResult = this.qualityGate.check(stage, this.ctx.store);
if (!qualityResult.passed) {
  this.ctx.store.write('quality-violations.json', JSON.stringify(qualityResult.violations));
  const stageStatus = run.stages[stage]!;
  stageStatus.retryCount++;
  transitionStage(run, stage, 'failed');
  transitionStage(run, stage, 'idle');
  this.ctx.eventBus.emit('quality:violation', stage, ...);
  return { type: 'retry', reason: `Quality gate: ${qualityResult.violations.length} violations`, attempt: stageStatus.retryCount };
}
```

### FixLoopRunner (MODIFIED)

| Change | Detail |
|--------|--------|
| Approach selection | Use `classifyErrorDetailed()` instead of round-number heuristic |
| Quality check | Optionally check quality gate on coder output before re-running tester |

### PipelineLoop (MODIFIED -- minimal)

| Change | Detail |
|--------|--------|
| Timing | Record stage start/end timestamps for StageMetrics |
| Metrics | Accumulate StageMetric array, pass via callback |

### RunContext (MODIFIED)

```typescript
export interface RunContext {
  // ...existing 7 fields unchanged...
  readonly tokenTracker: TokenTracker;  // NEW
}
```

### EventBus (MODIFIED)

```typescript
// New events:
'token:usage': (stage: StageName, inputTokens: number, outputTokens: number) => void;
'quality:violation': (stage: StageName, rule: string, message: string) => void;
'quality:passed': (stage: StageName) => void;
```

### Orchestrator (MODIFIED)

| Change | Detail |
|--------|--------|
| initRunContext | Create TokenTracker, wrap provider chain, create QualityGate |
| executePipeline | Pass QualityGate to StageExecutor constructor |
| postRun | Write `token-usage.json` and `stage-metrics.json` |

## Data Flow: Quality Gate

```
Agent writes artifacts + manifest to ArtifactStore
    ↓
QualityGate.check(stage, store)
    ├── ManifestContentValidator.validate(stage, store)
    │       ├── Do claimed files exist on disk?
    │       ├── Do files contain real code (not stubs)?
    │       └── Do coverage claims reference valid PRD feature IDs?
    ├── PlaceholderDetector.scan(stage, store)
    │       └── Regex scan for TODO/placeholder/NotImplemented patterns
    └── StageSpecificRules[stage]
            └── e.g., tester: check test file extensions are .test.ts not .test.tsx
    ↓
QualityCheckResult { passed, violations[], warnings[] }
    ↓
If !passed → StageExecutor returns retry + injects violations into store
If passed  → continue to gate check (auto/manual)
```

## Data Flow: Token Tracking

```
LLMAgent/CoderAgent calls provider.call(prompt, options)
    ↓
TokenTrackingProvider.call()
    ├── delegates to RetryingProvider → actual LLM call
    ├── reads response.usage { inputTokens, outputTokens }
    ├── calls tracker.recordUsage(currentStage, usage)
    ├── emits 'token:usage' event → CLI progress display
    └── returns response unchanged
    ↓
At pipeline end (Orchestrator.postRun):
    tracker.toJSON() → write token-usage.json to ArtifactStore
```

## Data Flow: Intelligent Error Classification

```
StageExecutor catches error OR FixLoopRunner reads test failures
    ↓
classifyErrorDetailed(message, stage)
    ├── regex matching (existing classifyError logic, preserved)
    ├── stage-aware heuristics (new)
    │       tester + 0 passed → 'fix-config'
    │       coder + repeated import error → 'replan'
    └── file path extraction from error text (new)
    ↓
ClassifiedError { category, rootCause, suggestedAction, affectedFiles }
    ↓
StageExecutor: use suggestedAction for retry/abort decision
FixLoopRunner: use suggestedAction to pick approach (replaces round heuristic)
```

## Recommended Project Structure (new/modified files only)

```
src/core/
├── quality-gate.ts            # NEW: QualityGate interface + DefaultQualityGate
├── manifest-validator.ts      # NEW: cross-ref manifest claims vs disk reality
├── placeholder-detector.ts    # NEW: stub/placeholder content scanning
├── token-tracker.ts           # NEW: TokenTracker + TokenTrackingProvider
├── stage-metrics.ts           # NEW: StageMetric type + accumulator
├── retry-log.ts               # MODIFIED: add classifyErrorDetailed()
├── stage-executor.ts          # MODIFIED: quality gate + error classification
├── run-context.ts             # MODIFIED: add tokenTracker field
├── event-bus.ts               # MODIFIED: add token/quality events
├── pipeline-loop.ts           # MODIFIED: stage timing
├── orchestrator.ts            # MODIFIED: wire new components + write reports
├── stage-outcome.ts           # NO CHANGE
├── fix-loop-runner.ts         # MODIFIED: use classifyErrorDetailed

src/core/__tests__/
├── quality-gate.test.ts       # NEW
├── manifest-validator.test.ts # NEW
├── placeholder-detector.test.ts # NEW
├── token-tracker.test.ts      # NEW
└── retry-log.test.ts          # MODIFIED: test classifyErrorDetailed
```

## Suggested Build Order

Dependencies flow: types/interfaces first, then implementations, then integration.

### Phase 1: Foundation (no integration, pure unit-testable)

1. **TokenTracker + TokenTrackingProvider** -- standalone decorator, depends only on LLMProvider interface. Add `tokenTracker` to RunContext.
2. **PlaceholderDetector** -- pure function: `(content: string, fileType: string) => PlaceholderMatch[]`. Zero dependencies.
3. **classifyErrorDetailed()** -- extend existing retry-log.ts. Pure function, no integration.
4. **StageMetrics type** -- just types + a simple accumulator.

### Phase 2: Quality Gate (depends on Phase 1 items #2)

5. **ManifestContentValidator** -- depends on ArtifactStore + manifest schemas + PlaceholderDetector.
6. **QualityGate** -- composes ManifestContentValidator + PlaceholderDetector + per-stage rules.

### Phase 3: Integration (wires into existing pipeline)

7. **StageExecutor integration** -- inject QualityGate, call after agent, handle violations.
8. **FixLoopRunner integration** -- use classifyErrorDetailed for approach selection.
9. **Orchestrator wiring** -- create tracker/gate in initRunContext, write reports in postRun.
10. **EventBus + CLI progress** -- add token/quality events, display in terminal.

### Build Order Rationale

- Phase 1 items have zero cross-dependencies and can be built/tested in parallel
- Phase 2 depends on PlaceholderDetector from Phase 1 but nothing else
- Phase 3 is the integration phase -- pure components are already tested before touching pipeline flow
- TokenTracker first because it only requires one RunContext field addition and follows the established RetryingProvider decorator pattern
- Quality gate before integration because gate rules need testing in isolation before they block real stages
- EventBus changes last because they're cosmetic (progress display) not functional

## Anti-Patterns to Avoid

### Anti-Pattern 1: Quality Gate as LLM Call

**What people do:** Use an LLM to judge output quality in the quality gate.
**Why it's wrong:** Quality gate must be fast, deterministic, and cheap. LLM validation is what the Reviewer and Validator agents already do. Adding LLM to the gate creates feedback loops (LLM judging LLM output with identical biases).
**Do this instead:** Mechanical checks only -- file existence, pattern matching, cross-referencing. Reserve LLM judgment for dedicated review stages.

### Anti-Pattern 2: Blocking on Warnings

**What people do:** Treat all quality issues as blocking violations.
**Why it's wrong:** Some issues (minor TODOs in comments, low test coverage) are acceptable trade-offs. Over-blocking causes infinite retry loops where the agent cannot satisfy the gate.
**Do this instead:** Distinguish `block` (must fix) from `warn` (logged, not blocking). Only stub implementation files and missing claimed files should block.

### Anti-Pattern 3: Token Tracking Inside Retry Loop

**What people do:** Put TokenTrackingProvider inside RetryingProvider, tracking only successful calls.
**Why it's wrong:** Retried calls still consume tokens and cost money. Tracking only successes underreports actual cost by potentially 2-20x.
**Do this instead:** TokenTrackingProvider wraps RetryingProvider (sits outside), seeing all calls including retries.

### Anti-Pattern 4: Mutating StageOutcome Union

**What people do:** Add new outcome types like `quality_failed` to handle quality gate failures.
**Why it's wrong:** The existing `retry` outcome with a reason string is semantically correct. Adding a new variant forces changes in PipelineLoop's switch statement and every consumer of StageOutcome.
**Do this instead:** Return `{ type: 'retry', reason: 'Quality gate: ...' }` and inject violation details via ArtifactStore file.

### Anti-Pattern 5: Per-Agent Quality Rules in Agent Code

**What people do:** Add quality self-checks inside each agent's `run()` method.
**Why it's wrong:** Agents are biased judges of their own output. Self-checks are easily gamed by the LLM (it generates code that passes its own checks but not external validation). Also violates separation of concerns -- agents produce, gates validate.
**Do this instead:** Quality gate runs externally after the agent finishes, using deterministic rules the agent cannot influence.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| QualityGate <-> StageExecutor | Direct sync call, returns QualityCheckResult | Gate returns result; executor decides retry vs proceed |
| TokenTracker <-> Provider chain | Decorator pattern (wraps LLMProvider) | Transparent to all callers of provider.call() |
| ManifestValidator <-> ArtifactStore | Read-only access to store | Never writes; only validates what agents wrote |
| StageMetrics <-> PipelineLoop | Accumulate in loop, pass via callback | Minimal change to loop logic |
| ErrorClassifier <-> FixLoopRunner | Pure function call | Replaces round-number heuristic with evidence-based approach |

### Event Bus Additions

| Event | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| `token:usage` | TokenTrackingProvider | CLIProgress | Display running token count + estimated cost |
| `quality:violation` | StageExecutor | CLIProgress, Logger | Show what failed quality gate |
| `quality:passed` | StageExecutor | CLIProgress | Confirm stage passed quality gate |

### Existing Hook Points (unused, available for future use)

BaseAgent has `preRunHooks` and `postRunHooks` arrays. Currently no production agent registers any hooks. These could be used for per-agent quality checks in the future, but the recommended approach is the external QualityGate pattern (see Anti-Pattern 5).

## Sources

- Direct codebase analysis of shipped v1.0 modules:
  - `src/core/orchestrator.ts` (208 lines)
  - `src/core/stage-executor.ts` (207 lines)
  - `src/core/pipeline-loop.ts` (118 lines)
  - `src/core/fix-loop-runner.ts` (130 lines)
  - `src/core/run-context.ts` (65 lines)
  - `src/core/agent.ts` (231 lines, BaseAgent + hooks)
  - `src/agents/llm-agent.ts` (102 lines)
  - `src/core/manifest.ts` (329 lines, all 11 manifest schemas)
  - `src/core/retry-log.ts` (173 lines, 9 error categories)
  - `src/core/retrying-provider.ts` (165 lines, decorator pattern)
  - `src/core/llm-provider.ts` (38 lines, LLMResponse.usage already defined)
  - `src/core/event-bus.ts` (60 lines, typed event interface)
  - `src/core/stage-outcome.ts` (24 lines, 6-variant discriminated union)
  - `src/agents/coder.ts` (226 lines, sub-module delegation pattern)
  - `src/core/artifact-store.ts` (87 lines)
- `.planning/PROJECT.md` -- v1.1 requirements and run-1774640936546 quality baseline

---
*Architecture research for: Quality gate enforcement & cost optimization integration*
*Researched: 2026-03-28*
