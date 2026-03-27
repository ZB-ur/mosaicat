# Architecture Patterns

**Domain:** TypeScript multi-agent pipeline orchestration engine rewrite
**Researched:** 2026-03-26

## Recommended Architecture

### Design Principle: Run-Scoped Context Object

The single most important architectural change is replacing module-level mutable state with a **`RunContext`** object that flows through the entire execution. Every function that touches run-specific data receives it via parameter, never via global/module state.

```
RunContext {
  runId: string
  artifactStore: ArtifactStore    // instance, not module globals
  logger: Logger                  // instance, scoped to runId
  provider: LLMProvider           // instance, possibly wrapped
  eventBus: EventBus              // instance, not singleton export
  pipelineRun: PipelineRun        // mutable state container
  config: Readonly<ResolvedConfig> // frozen after construction
}
```

This is the "context object" pattern (not to be confused with React context). It replaces:
- `currentRunDir` global in `artifact.ts`
- `eventBus` singleton in `event-bus.ts`
- Scattered `provider`, `logger`, `run` parameters threaded through every method
- Mutable `this.agentsConfig` on Orchestrator

### Component Boundaries

| Component | Responsibility | Receives | Produces |
|-----------|---------------|----------|----------|
| **RunContext** (new) | Holds all run-scoped instances | Config + runId | Passed to all components |
| **StageExecutor** (new) | Execute a single stage: build context, run agent, handle gate | RunContext + StageName | StageResult (success/rejected/failed) |
| **FixLoopRunner** (new) | Tester-Coder retry loop with progressive strategy | RunContext + stage list slice | FixLoopResult (pass/fail + round count) |
| **PipelineLoop** (new) | Iterative stage sequencing, replaces recursive executeStage | RunContext + stage list | Completed PipelineRun |
| **Orchestrator** (rewritten) | Thin facade: create RunContext, delegate to PipelineLoop | CLI/MCP args | PipelineRun |
| **ArtifactStore** (new) | Instance-scoped artifact I/O | runId + baseDir | read/write/exists methods |
| **ContextBuilder** (renamed) | Build AgentContext from config + artifacts + skills | ArtifactStore + config | AgentContext |
| **ErrorChannel** (new) | Unified error handling: log + classify + decide | Error + stage context | ErrorDecision (retry/fail/skip) |
| **ShutdownCoordinator** (new) | SIGINT/SIGTERM graceful shutdown | Process signals | Abort signal to PipelineLoop |

### What Stays Unchanged (Frozen Interfaces)

These are **not rewritten** -- the new components must conform to their existing interfaces:

- `PipelineRun`, `StageName`, `StageStatus`, `AgentContext` (from `types.ts`)
- `LLMProvider` interface (from `llm-provider.ts`)
- `InteractionHandler` interface (from `interaction-handler.ts`)
- `GitPlatformAdapter` interface (from `adapters/types.ts`)
- `BaseAgent` / `LLMAgent` base classes (from `agent.ts` / `llm-agent.ts`)
- `pipeline.ts` state machine functions (`createPipelineRun`, `transitionStage`, etc.)

## Data Flow

### New Pipeline Execution Flow

```
CLI/MCP
  |
  v
Orchestrator.run(instruction, profile)
  |
  |--> ResolvedConfig = freeze(loadPipelineConfig() + loadAgentsConfig())
  |--> RunContext = createRunContext(runId, config, handler, adapter?)
  |      |
  |      |--> ArtifactStore(runId, baseDir)
  |      |--> Logger(runId)
  |      |--> createProvider(config)  // wrapped with RetryingProvider
  |      |--> EventBus()              // fresh instance, not singleton
  |      |--> ShutdownCoordinator()
  |
  |--> PipelineLoop.execute(ctx, stageList)
         |
         |--> for each stage (iterative, no recursion):
         |      |
         |      |--> StageExecutor.execute(ctx, stage)
         |      |      |
         |      |      |--> ContextBuilder.build(ctx.artifactStore, ctx.config, stage)
         |      |      |--> AgentFactory.create(stage, ctx.provider, ctx.logger)
         |      |      |--> agent.execute(agentContext)
         |      |      |--> GateHandler.check(ctx, stage, result)
         |      |      |      |--> auto? --> done
         |      |      |      |--> manual? --> handler.onManualGate()
         |      |      |      |      |--> approved --> done
         |      |      |      |      |--> rejected --> StageResult.rejected(feedback)
         |      |      |--> return StageResult
         |      |
         |      |--> if result.rejected && retryCount < max:
         |      |      retryCount++; continue (same stage, no recursion)
         |      |
         |      |--> if stage === 'tester' && verdict === fail:
         |      |      FixLoopRunner.run(ctx, coderIdx..testerIdx)
         |      |
         |      |--> ctx.artifactStore.saveState(pipelineRun)
         |
         |--> return pipelineRun
```

### Key Data Flow Rules

1. **Config is frozen at construction.** `ResolvedConfig` is a deep-frozen snapshot of `pipeline.yaml` + `agents.yaml`. No component mutates it. The tester-coder injection creates a *new* config slice, never mutates the shared one.

2. **ArtifactStore is the only disk interface.** No component calls `fs.readFileSync`/`fs.writeFileSync` directly for artifacts. ArtifactStore encapsulates path resolution, directory creation, and provides typed methods.

3. **Errors flow up via return types, not exceptions (for expected cases).** `StageResult` is a discriminated union: `{ status: 'done' } | { status: 'rejected', feedback } | { status: 'failed', error }`. Only unexpected errors (bugs, infra failures) throw.

4. **Events are scoped to the RunContext's EventBus instance.** CLI progress and MCP tools subscribe to the specific instance, not a global singleton. This enables concurrent runs in the future.

## Patterns to Follow

### Pattern 1: Iterative Stage Retry (replaces recursive executeStage)

**What:** A `while` loop with explicit retry counter replaces recursive `this.executeStage()` calls.

**When:** Any stage execution with retry logic.

**Why:** The current code recurses on rejection (line 515) and on failure (lines 567, 582). This grows the call stack linearly with retry count. An iterative loop keeps constant stack depth.

```typescript
// StageExecutor.execute() — iterative, not recursive
async execute(ctx: RunContext, stage: StageName): Promise<StageResult> {
  const maxRetries = ctx.config.stages[stage].retry_max;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const agentContext = this.contextBuilder.build(ctx, stage);

    try {
      await this.runAgent(ctx, stage, agentContext);
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        return { status: 'failed', error: err };
      }
      ctx.errorChannel.log(err, stage, attempt);
      continue; // retry — no recursion
    }

    const gateResult = await this.gateHandler.check(ctx, stage);
    if (gateResult.approved) {
      return { status: 'done' };
    }

    // Rejected — inject feedback and retry
    attempt++;
    if (attempt > maxRetries) {
      return { status: 'failed', error: new Error(`Rejected ${attempt} times`) };
    }
    agentContext.inputArtifacts.set('rejection_feedback', gateResult.feedback);
    // loop continues — no recursion
  }

  return { status: 'failed', error: new Error('Unreachable') };
}
```

### Pattern 2: ArtifactStore Instance (replaces module globals)

**What:** An `ArtifactStore` class that encapsulates artifact path resolution and I/O, scoped to a single run.

**When:** Any artifact read/write operation.

**Why:** The current `artifact.ts` uses `currentRunDir` as a module-level mutable variable. This breaks test isolation and prevents concurrent runs.

```typescript
export class ArtifactStore {
  private readonly runDir: string;

  constructor(runId: string, baseDir = '.mosaic/artifacts') {
    this.runDir = path.join(baseDir, runId);
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  write(name: string, content: string): void {
    const filePath = path.join(this.runDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  read(name: string): string {
    return fs.readFileSync(path.join(this.runDir, name), 'utf-8');
  }

  exists(name: string): boolean {
    return fs.existsSync(path.join(this.runDir, name));
  }

  getDir(): string {
    return this.runDir;
  }
}
```

**Backward compatibility:** The existing `writeArtifact()`, `readArtifact()`, `artifactExists()` free functions remain as thin wrappers that delegate to a thread-local or parameter-injected store. This allows agents that import these functions to continue working during incremental migration.

### Pattern 3: Frozen Config (replaces mutable config injection)

**What:** Deep-freeze pipeline and agent configs at load time. Any per-stage config modifications create new objects.

**When:** Orchestrator construction and tester-coder injection.

**Why:** The current `injectTestFailuresForCoder` mutates `this.agentsConfig.agents['coder'].inputs` permanently, which persists across retries and can corrupt subsequent runs.

```typescript
// At Orchestrator construction:
const rawPipeline = yaml.load(fs.readFileSync('config/pipeline.yaml', 'utf-8'));
const rawAgents = yaml.load(fs.readFileSync('config/agents.yaml', 'utf-8'));
const config: ResolvedConfig = Object.freeze({
  pipeline: deepFreeze(rawPipeline),
  agents: deepFreeze(rawAgents),
});

// When injecting test failures:
function withTestFailureInputs(
  agentConfig: Readonly<AgentStageConfig>,
  history: AttemptHistory[]
): AgentStageConfig {
  return {
    ...agentConfig,
    inputs: [...agentConfig.inputs, 'test_failures'],
    // history injected via artifact, not config mutation
  };
}
```

### Pattern 4: Discriminated Union Results (replaces exception-driven control flow)

**What:** Stage execution returns typed result objects instead of using exceptions for expected outcomes (rejection, clarification needed).

**When:** Any point where an operation has multiple expected outcomes.

```typescript
type StageResult =
  | { status: 'done' }
  | { status: 'rejected'; feedback: string; retryComponents?: string[] }
  | { status: 'failed'; error: Error }
  | { status: 'skipped'; reason: string }
  | { status: 'needs_clarification'; question: string };
```

**Why:** The current `ClarificationNeeded` exception class is thrown from agents and caught by the orchestrator. This mixes control flow with error handling. Discriminated unions make the control flow explicit and type-checked at compile time.

### Pattern 5: Extract FixLoopRunner (replaces index manipulation)

**What:** A dedicated `FixLoopRunner` class encapsulates the tester-coder retry loop.

**When:** After tester stage reports failures.

**Why:** The current code manipulates the `for` loop index (`i = coderIdx - 1`) to replay stages. This couples fix-loop logic to the main iteration variable and duplicates logic between `run()` and `resumeRun()`.

```typescript
class FixLoopRunner {
  private readonly maxRounds = 5;
  private readonly replanThreshold = 3;

  async run(ctx: RunContext, stageExecutor: StageExecutor): Promise<FixLoopResult> {
    const history: AttemptRecord[] = [];

    for (let round = 1; round <= this.maxRounds; round++) {
      const approach = this.pickStrategy(round);

      // Re-run coder with injected failure context
      const coderResult = await stageExecutor.execute(ctx, 'coder');
      if (coderResult.status === 'failed') break;

      // Re-run tester
      const testerResult = await stageExecutor.execute(ctx, 'tester');
      if (testerResult.status === 'done' && this.checkVerdict(ctx)) {
        return { status: 'pass', rounds: round };
      }

      history.push({ round, approach, failures: this.readFailures(ctx) });
    }

    return { status: 'fail', rounds: this.maxRounds, history };
  }

  private pickStrategy(round: number): string {
    if (round < this.replanThreshold) return 'direct-fix';
    if (round === this.replanThreshold) return 'replan-failed-modules';
    return 'full-history-fix';
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Singleton Event Bus
**What:** Exporting `export const eventBus = new EventBus()` as a module-level singleton.
**Why bad:** All runs share the same bus. Subscribers from a previous run may receive events from the next. Tests must call `removeAllListeners()` to avoid cross-test pollution.
**Instead:** Create `EventBus` as part of `RunContext`. CLI progress subscribes to the specific instance. `removeAllListeners()` in tests becomes unnecessary.

### Anti-Pattern 2: Silent Catch Blocks
**What:** `catch {}` or `catch { /* non-fatal */ }` with no logging.
**Why bad:** 16 silent catch blocks across evolution engine (9), validator (7). Corrupted data, missing files, or format changes are invisible. The system appears to work while producing degraded output.
**Instead:** Every catch block must either: (a) log at warn level via the logger, or (b) return an explicit error status. Use a `safeCall` helper:

```typescript
function safeCall<T>(
  fn: () => T,
  fallback: T,
  logger: Logger,
  context: string
): T {
  try {
    return fn();
  } catch (err) {
    logger.pipeline('warn', `${context}:fallback`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}
```

### Anti-Pattern 3: God Object Orchestrator
**What:** A 1057-line class that handles pipeline sequencing, stage execution, retry logic, fix loops, state persistence, git publishing, issue creation, evolution, resume, preview comments, and config resolution.
**Why bad:** Every change to any concern risks breaking unrelated functionality. Testing requires mocking everything.
**Instead:** Orchestrator becomes a thin facade (< 200 lines) that wires together: `PipelineLoop`, `StageExecutor`, `FixLoopRunner`, `GitPublisher`, `IssueManager`. Each is independently testable.

### Anti-Pattern 4: Recursive Retry
**What:** `return this.executeStage(run, stage, provider, logger)` for retries.
**Why bad:** Stack depth grows with retry count. Stack traces become unreadable. No explicit retry counter -- it's buried in `stageStatus.retryCount` which is mutated as a side effect.
**Instead:** Iterative while-loop with explicit attempt counter (see Pattern 1).

### Anti-Pattern 5: Module-Level Mutable State for Per-Request Data
**What:** `let currentRunDir: string` at module scope in `artifact.ts`.
**Why bad:** Any code that imports `artifact.ts` shares the same mutable state. Two overlapping calls to `initArtifactsDir()` corrupt each other. Tests need explicit `setBaseDir()`/`resetBaseDir()` ceremony.
**Instead:** Instance-scoped `ArtifactStore` (see Pattern 2).

## Module Dependency Graph (New Architecture)

```
index.ts (CLI) ──────────────────────────────┐
mcp-entry.ts (MCP) ─────────────────────────┐│
                                             ││
                                             vv
                                    Orchestrator (facade)
                                         |
                        ┌────────────────┤
                        v                v
                  RunContext         PipelineLoop
                  (factory)              |
                     |          ┌───────┼────────┐
                     v          v       v        v
                ArtifactStore  StageExecutor  FixLoopRunner
                Logger         |       |
                EventBus       v       v
                Provider    ContextBuilder  GateHandler
                Config      AgentFactory    ErrorChannel
                Shutdown       |
                               v
                           BaseAgent / LLMAgent
                               |
                               v
                           LLMProvider (interface)
```

**Dependency rules:**
- Arrows point downward only -- no circular dependencies
- `RunContext` is created by Orchestrator, passed by reference to PipelineLoop and StageExecutor
- `StageExecutor` never imports `PipelineLoop`; `FixLoopRunner` receives `StageExecutor` as a parameter
- No component imports the singleton `eventBus`; all use `ctx.eventBus`
- `ArtifactStore` is the only component that calls `fs.*` for artifact paths

## Coder Agent Decomposition

The 1312-line `CoderAgent` splits into 4 focused modules:

| Module | Lines (est.) | Responsibility | Depends On |
|--------|-------------|----------------|------------|
| `CoderPlanner` | ~150 | Generate/load `code-plan.json` from tech-spec + api-spec | LLMProvider, ArtifactStore |
| `CoderBuilder` | ~300 | Skeleton phase + per-module implementation | LLMProvider, ArtifactStore, CodePlan |
| `BuildVerifier` | ~200 | npm install, tsc verify, build command, fix loops | ArtifactStore (for reading build output) |
| `SmokeRunner` | ~150 | HTTP smoke test, bundle analysis, placeholder detection | ArtifactStore |
| `CoderAgent` (orchestrator) | ~200 | Wire the 4 sub-modules, write manifest + README | All above |

**Build order:** CoderPlanner and BuildVerifier have no cross-dependency and can be built in parallel. CoderBuilder depends on CodePlan types. SmokeRunner is independent. CoderAgent (the orchestrator) wires them together last.

## Suggested Build Order

Based on dependency analysis, the components should be built bottom-up:

### Layer 1: Foundation (no new dependencies)
1. **ArtifactStore** -- self-contained, replaces module globals. All other components depend on it.
2. **ErrorChannel** -- self-contained utility. Used by everything above.
3. **ResolvedConfig + freeze utility** -- self-contained. Used by RunContext.

### Layer 2: RunContext Assembly
4. **RunContext factory** -- combines ArtifactStore + Logger + EventBus + Provider + Config. This is the "big bang" moment where the new architecture connects.
5. **Backward-compat shims** -- thin wrappers so existing `writeArtifact()` / `readArtifact()` / `eventBus` imports continue working during migration.

### Layer 3: Execution Components
6. **StageExecutor** -- iterative retry loop, context building, gate handling. Replaces `executeStage()`.
7. **ContextBuilder** -- refactored from `context-manager.ts` to accept ArtifactStore instead of importing global functions.
8. **GateHandler** -- extracted from Orchestrator's inline gate logic.

### Layer 4: Specialized Loops
9. **FixLoopRunner** -- extracted from Orchestrator's tester-coder loop.
10. **PipelineLoop** -- the main `for` loop, now calling StageExecutor and FixLoopRunner.

### Layer 5: Coder Decomposition
11. **CoderPlanner** + **BuildVerifier** (parallel, no cross-dependency)
12. **CoderBuilder** (depends on CodePlan types)
13. **SmokeRunner** (independent)
14. **CoderAgent rewrite** (wires sub-modules)

### Layer 6: Cleanup
15. **Silent catch elimination** -- evolution engine (9 catches) + validator (7 catches)
16. **ShutdownCoordinator** -- SIGINT/SIGTERM handling
17. **Orchestrator facade** -- thin wrapper, < 200 lines
18. **console.log cleanup** -- route 30+ direct outputs through logger

**Rationale for this order:**
- Layer 1-2 establishes the foundation that everything else depends on. Without ArtifactStore, nothing can be tested in isolation.
- Layer 3 is the core execution path. StageExecutor must exist before PipelineLoop or FixLoopRunner.
- Layer 4 depends on StageExecutor existing.
- Layer 5 (Coder) is independent of the orchestration rewrite and can technically happen in parallel with Layers 3-4.
- Layer 6 is cleanup that can happen at any point after the component it touches is rewritten.

## Scalability Considerations

| Concern | Current (single run) | After rewrite | Future (parallel stages) |
|---------|---------------------|---------------|--------------------------|
| State isolation | Module globals -- impossible | RunContext instance -- safe | Same RunContext, stage-level locks |
| Concurrent runs | Breaks (shared `currentRunDir`) | Works (each run has own RunContext) | Works |
| Test isolation | Fragile (`setBaseDir`/`resetBaseDir`) | Natural (new ArtifactStore per test) | Natural |
| Error visibility | 16 silent catches | All errors logged | Same |
| Stack depth | O(retries) recursive | O(1) iterative | O(1) |
| Config safety | Mutable shared object | Frozen at construction | Frozen |

## Sources

- Current codebase analysis: `src/core/orchestrator.ts`, `src/core/artifact.ts`, `src/core/event-bus.ts`, `src/core/context-manager.ts`, `src/agents/coder.ts`
- [The Pipeline Pattern: Streamlining Data Processing](https://dev.to/wallacefreitas/the-pipeline-pattern-streamlining-data-processing-in-software-architecture-44hn)
- [TypeScript at Scale in 2026](https://blog.logrocket.com/typescript-at-scale-2026/)
- [Typesafe Zero Cost DI in TypeScript](https://dev.to/vad3x/typesafe-almost-zero-cost-dependency-injection-in-typescript-112)
- [Multi-Agent AI Orchestration in TypeScript](https://dev.to/arslan_mecom/multi-agent-ai-orchestration-in-typescript-agentgraph-supervisors-and-delegate-with-hazeljs-5241)
- Project documents: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`

---

*Architecture research: 2026-03-26*
