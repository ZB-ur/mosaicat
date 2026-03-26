# Feature Landscape

**Domain:** AI multi-agent pipeline orchestration engine (core engine rewrite)
**Researched:** 2026-03-26
**Overall Confidence:** MEDIUM-HIGH

## Table Stakes

Features that any reliable agent orchestration engine must have. Missing = pipeline feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Structured error visibility (no silent catches) | Silent catch blocks are the #1 anti-pattern in agent pipelines. LangGraph, CrewAI all surface errors explicitly. Mosaicat has 16+ silent catches across evolution engine and validator. | Low | Replace bare `catch {}` with `catch(e) { logger.warn(...); return fallback }`. Mechanical but high-value. |
| Finite retry with exponential backoff + jitter | Industry standard since 2023. Current `maxRetries: Infinity` is a known anti-pattern. LangGraph uses per-node `RetryPolicy` with `max_attempts`. | Low | Change default from `Infinity` to 20. Already has backoff + jitter. One-line fix + tests. |
| Circuit breaker on LLM provider | If provider returns 5xx for 5+ consecutive calls, stop hammering it. Standard pattern (CLOSED/OPEN/HALF_OPEN states). Without this, a down provider burns wall-clock hours. | Medium | Add circuit breaker wrapper around `RetryingProvider`. Three states: CLOSED (normal), OPEN (fail-fast after N consecutive failures), HALF_OPEN (test with single request). Use `opossum` or hand-roll (~100 lines). |
| Graceful shutdown (SIGINT/SIGTERM) | Every production pipeline system handles this. Current Mosaicat has zero signal handlers — Ctrl+C mid-LLM-call leaves partial state. LangGraph persists checkpoints after each superstep specifically for this. | Medium | Register signal handlers in CLI entry + orchestrator. On signal: set shutdown flag, let current stage finish writing artifacts + pipeline-state.json, then exit. Must not corrupt state files. |
| Artifact isolation per run | Global mutable `currentRunDir` is a textbook anti-pattern. LangGraph scopes state per `thread_id`. CrewAI isolates per task. Any concurrent usage (MCP serving two clients) would corrupt state. | Medium | Replace module-level `currentRunDir` with `ArtifactStore` class instance passed through call chain. Each run gets its own store. Tests get isolated stores without `setBaseDir()`/`resetBaseDir()` hacks. |
| Error classification (retriable vs fatal) | Already partially implemented via `isRetryableError()`. Table stakes because retrying a 401 auth error or ENOENT spawn failure forever wastes time. LangGraph's `retry_on` condition does this. | Low | Current implementation is adequate. Ensure circuit breaker respects same classification. |
| Iterative execution (no recursive stack growth) | Recursive `executeStage()` for retries/rejections risks stack overflow. Every mature orchestrator uses iterative loops. | Medium | Convert orchestrator's retry/rejection recursion to `while` loop with retry counter. Also extract Tester-Coder fix loop from index manipulation to dedicated method. |
| Unified structured logging | 30+ `console.log` calls bypass the logger. In production agent systems, all output goes through structured logging for aggregation, filtering, replay. AgentTrace (2025 paper) emphasizes operational + cognitive + contextual log surfaces. | Low-Med | Route all output through `Logger` module. Add log levels (debug/info/warn/error). Low complexity per call site, medium total effort due to 30+ locations. |
| Immutable config during execution | Mutable config injection (`this.agentsConfig.agents['coder'].inputs.push(...)`) persists across retries. Every pipeline engine treats config as read-only during execution. | Low | Clone config before mutation. `structuredClone()` or spread before push. |
| Resume from checkpoint | Already exists but lacks integration tests. LangGraph's entire persistence model is built around this — save after each superstep, resume from last good checkpoint. Table stakes for any long-running pipeline. | Medium | Not a new feature — but resume tests are a table-stakes gap. Cover `resumeRun()`, `--from` stage reset, artifact cleanup. |

## Differentiators

Features that go beyond what most agent orchestration engines provide. Not expected, but significantly improve the experience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-stage error context propagation | When a stage fails, downstream stages and the user see exactly what failed and why, not just "stage X failed". Include LLM response snippets, validation errors, and the specific artifact that was malformed. | Medium | Enhance `StageStatus` with structured error info (error type, message, failing artifact, truncated LLM response). Propagate through event bus for progress display. |
| Progressive retry strategies per stage | Different stages need different retry behavior. LLM validation errors should retry with feedback injection. Network errors should retry with backoff. Schema parse failures should fail fast. The Tester-Coder fix loop already does this (rounds 1-2 direct-fix, 3 replan, 4-5 full-history). Generalize the pattern. | High | This is partially built for Tester-Coder. Generalizing to all stages requires a `RetryStrategy` interface per stage type. Defer generalization; clean up existing implementation first. |
| Artifact integrity verification on resume | When resuming, verify not just that artifact files exist but that they parse correctly (valid JSON/YAML/manifest). Current resume only checks file existence. LangGraph verifies checkpoint integrity. | Low-Med | Add schema validation pass during `validateResumeState()`. Already have Zod schemas for all manifests. |
| Elapsed-time circuit breaker (total run budget) | Beyond per-call retries: if a single stage has been running for >30min total (across all retries), force-fail it. Prevents runaway cost in stuck pipelines. No major framework does this well yet. | Low | Track stage start time. Check elapsed before each retry. Simple timer-based check in orchestrator loop. |
| Structured stage telemetry | Emit timing, token usage, retry count, and error summary per stage as structured events. Enable post-run analysis without parsing logs. | Medium | Extend event bus events with telemetry payload. Aggregate in orchestrator. Write summary to run metadata. |
| Context-aware fallback on missing prompts | Current context manager silently falls back to a one-liner prompt when agent prompt files are missing. Instead: fail-fast in production, warn + fallback in dev mode. | Low | Add mode check. In prod: throw. In dev: `logger.warn()` + fallback. Tiny change, big reliability improvement. |

## Anti-Features

Features to explicitly NOT build during this rewrite. These were considered and rejected.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Parallel stage execution | Architecturally interesting but not a debt fix. Adds massive complexity to artifact isolation, state management, and error handling. Current pipeline is sequential by design. | Keep sequential execution. The ArtifactStore refactor _enables_ future parallelism but don't implement it now. |
| Event bus persistence / replay | Tempting for resume, but the current checkpoint-based resume (pipeline-state.json + artifact files) is sufficient. Event replay adds storage, serialization, and ordering complexity. | Keep fire-and-forget events. Improve checkpoint-based resume instead. |
| Pipeline-level cost tracking / budget enforcement | Requires billing infrastructure, per-provider token counting (which varies by model), and budget policy UX. Out of scope for engine rewrite. | Track token counts in telemetry events for observability, but don't enforce budgets. |
| Shell command whitelist validation | YOLO mode by design — LLM has full shell access. Whitelist provides false security and breaks legitimate commands. | Keep current model. Document security implications. |
| Generic agent plugin system | Over-engineering. The 13-agent pipeline is the product. A plugin API would add abstraction without users. | Keep `AGENT_MAP` in agent-factory. Adding a new agent is already a one-file-plus-registration operation. |
| Distributed execution / multi-process | No use case. Single user, single pipeline, single machine. Distribution adds networking, serialization, and failure modes. | Keep single-process. The ArtifactStore refactor removes the _blocker_ to multi-process, but don't go there. |
| Auto-healing / self-repair agents | Some frameworks (AutoGen) let agents "reflect on mistakes and try again." This is the Tester-Coder fix loop already. Don't generalize to all stages — most stages have deterministic success criteria. | Keep fix loop for Tester-Coder only. Other stages use simple retry. |

## Feature Dependencies

```
Artifact isolation (ArtifactStore) → enables clean testing, enables future parallelism
                                   → required by: resume integrity verification

Structured error visibility → required by: per-stage error context propagation
                            → required by: circuit breaker (needs error classification)

Finite retry + circuit breaker → depends on: error classification (already exists)
                               → depends on: structured logging (to report state transitions)

Iterative execution loop → enables: elapsed-time circuit breaker (needs loop to check timer)
                         → enables: clean Tester-Coder fix loop extraction

Unified logging → required by: all observability features
               → required by: context-aware fallback (needs logger.warn)

Graceful shutdown → depends on: iterative execution (needs loop exit point, not recursion unwind)
                  → depends on: artifact write completion (must finish current write)
```

## MVP Recommendation (Rewrite Scope)

**Must ship (table stakes that fix real broken things):**

1. **Structured error visibility** — Eliminate all 16 silent catches. Highest ROI, lowest risk. Do first.
2. **Finite retry + circuit breaker** — Change `Infinity` default, add circuit breaker wrapper. Prevents stuck pipelines.
3. **Artifact isolation (ArtifactStore)** — Replace global mutable state. Required for test isolation and MCP correctness.
4. **Iterative execution loop** — Convert recursive `executeStage` to loop. Extract Tester-Coder fix loop. Structural prerequisite for graceful shutdown.
5. **Graceful shutdown** — Signal handlers + controlled exit. Depends on iterative loop being in place.
6. **Unified logging** — Route 30+ console.log through logger. Tedious but necessary for observability.
7. **Immutable config** — Clone before mutate. One-line fixes, zero risk.
8. **Resume integration tests** — Not a feature but a table-stakes gap. Cover the untested critical path.

**Should ship (differentiators worth the effort):**

9. **Elapsed-time circuit breaker** — Simple timer check in orchestrator loop. Low effort, high value for stuck stages.
10. **Context-aware fallback** — Fail-fast on missing prompts in prod. Tiny change.
11. **Artifact integrity verification on resume** — Validate artifact schemas, not just file existence.

**Defer (not this milestone):**

- Per-stage error context propagation — Nice but requires UX design for error display
- Progressive retry strategies — Partially exists, generalization is over-engineering
- Structured stage telemetry — Observability luxury, not debt fix

## Recommended Phase Ordering

Based on dependencies:

1. **Error visibility + logging** (no dependencies, unblocks everything)
2. **ArtifactStore + immutable config** (foundational refactors)
3. **Iterative execution + Coder decomposition** (structural changes)
4. **Retry/circuit breaker + graceful shutdown** (depends on iterative loop)
5. **Resume tests + integrity verification** (depends on ArtifactStore)

## Sources

- [LangGraph Error Handling and Retry Policies](https://deepwiki.com/langchain-ai/langgraph/3.7-error-handling-and-retry-policies) — Node-level retry with RetryPolicy, checkpoint-based recovery
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) — Checkpoint state management, thread-scoped persistence
- [AI Agent Error Handling Best Practices 2025](https://fast.io/resources/ai-agent-error-handling/) — Error classification, retry patterns
- [Circuit Breaker Pattern in Node.js and TypeScript](https://dev.to/wallacefreitas/circuit-breaker-pattern-in-nodejs-and-typescript-enhancing-resilience-and-stability-bfi) — CLOSED/OPEN/HALF_OPEN implementation
- [Building Resilient Systems: Circuit Breakers and Retry Patterns](https://dasroot.net/posts/2026/01/building-resilient-systems-circuit-breakers-retry-patterns/) — Combined retry + circuit breaker
- [AgentTrace: Structured Logging Framework for Agent System Observability](https://arxiv.org/abs/2602.10133) — Operational, cognitive, contextual log surfaces
- [AI Agent Observability: From Black-Box to Traceable Systems](https://wandb.ai/site/articles/ai-agent-observability/) — Silent error swallowing case studies
- [Agents At Work: The 2026 Playbook for Reliable Agentic Workflows](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) — Production reliability patterns
- [AI Agent Frameworks: CrewAI vs AutoGen vs LangGraph (2026)](https://designrevision.com/blog/ai-agent-frameworks) — Task-level error boundaries, conversational retries
- [Graceful Shutdown in Distributed Systems](https://www.geeksforgeeks.org/system-design/graceful-shutdown-in-distributed-systems-and-microservices/) — Signal handling, connection draining patterns
- [Anti-Patterns in Exception Handling](https://prgrmmng.com/anti-patterns-exception-handling) — Error swallowing, over-catching anti-patterns

---

*Features research: 2026-03-26*
