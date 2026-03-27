# Project Research Summary

**Project:** Mosaicat v2 Core Engine Rewrite
**Domain:** TypeScript multi-agent pipeline orchestration engine (partial rewrite: ~70% rewrite, ~30% preserved)
**Researched:** 2026-03-26
**Confidence:** HIGH

## Executive Summary

Mosaicat v2 is a surgical rewrite of a working but debt-laden 15K-line TypeScript multi-agent pipeline engine. The research across stack, features, architecture, and pitfalls converges on a single thesis: the problems are structural (global mutable state, recursive execution, god-object orchestrator, silent error swallowing) and the fixes are well-understood patterns (instance scoping, iterative loops, facade extraction, explicit error returns). No exotic technology is needed -- the rewrite uses TypeScript built-in patterns (discriminated unions, AbortController), one optional dependency (cockatiel for resilience), and zero framework changes. The existing pipeline state machine, agent base classes, and all interface contracts are preserved untouched.

The recommended approach is a bottom-up strangler fig: rewrite leaf modules first (ArtifactStore, error handling), then mid-tier (StageExecutor, ContextBuilder), then the orchestrator facade last. All four research streams agree on this ordering. The critical insight is that the orchestrator is the hub of all dependencies -- rewriting it early creates a combinatorial explosion of integration breakage, while rewriting it last lets each component stabilize before integration. The Coder agent decomposition (1312 lines to 4 modules) is architecturally independent and can proceed in parallel with the orchestration rewrite.

The highest-risk areas are: (1) singleton state contamination during the ArtifactStore transition (preserved code calling global functions while rewritten code uses the instance), (2) test suite false confidence (mock-heavy tests pass while real integration breaks), and (3) phantom interface drift (TypeScript types match but runtime behavior diverges). All three are mitigated by writing behavioral contract tests and integration tests BEFORE rewriting any module -- making test infrastructure hardening the mandatory first phase.

## Key Findings

### Recommended Stack

No new frameworks. The rewrite uses TypeScript's own type system and Node.js built-ins for almost everything. The only potential new dependency is `cockatiel` for retry/circuit-breaker composition, and even that can be hand-rolled.

**Core patterns (not libraries):**
- **Custom `Result<T, E>` type**: 50-line file replacing 16 silent catch blocks with explicit typed error returns. Rejected Effect-TS (paradigm mismatch) and neverthrow (unmaintained).
- **`RunContext` object**: Single context parameter replacing 5+ constructor args, carrying ArtifactStore, Logger, Provider, EventBus, Config per run. Rejected DI frameworks (tsyringe, InversifyJS) as overkill for 13 agents.
- **Iterative `while` loop + `StageOutcome` discriminated union**: Replaces recursive `executeStage()`. Rejected XState (existing pipeline.ts state machine works; XState solves a different problem).
- **`ArtifactStore` class per run**: Replaces module-level `currentRunDir` global. Instance-scoped, test-isolated, future-concurrent.
- **`cockatiel` (optional)**: Retry with exponential backoff + circuit breaker + timeout. Replaces `maxRetries: Infinity` default. Can hand-roll if dependency aversion is strong.
- **`AbortController`**: Node.js built-in for graceful SIGINT/SIGTERM shutdown through the pipeline.

**What stays unchanged:** TypeScript 5.9, Vitest 4.1, Zod 4.3, p-queue, eventemitter3, Anthropic SDK, Playwright.

### Expected Features

**Must have (table stakes -- fix real broken things):**
1. Structured error visibility -- eliminate all 16 silent catches
2. Finite retry (20) + circuit breaker -- prevent stuck pipelines
3. Artifact isolation (ArtifactStore) -- eliminate global mutable state
4. Iterative execution loop -- eliminate recursive stack growth
5. Graceful shutdown -- SIGINT/SIGTERM handler with clean state save
6. Unified logging -- route 30+ console.log calls through logger
7. Immutable config -- clone-before-mutate for `agentsConfig`
8. Resume integration tests -- cover the untested critical path

**Should have (differentiators worth the effort):**
9. Elapsed-time circuit breaker -- force-fail stages stuck > 30min
10. Context-aware fallback -- fail-fast on missing prompts in production
11. Artifact integrity verification on resume -- validate schemas, not just file existence

**Defer (not this rewrite):**
- Parallel stage execution -- ArtifactStore enables it, but don't implement now
- Event bus persistence/replay -- checkpoint-based resume is sufficient
- Pipeline-level cost tracking -- needs billing infrastructure
- Generic agent plugin system -- the 13-agent pipeline IS the product
- Per-stage error context propagation -- needs UX design for error display

### Architecture Approach

The rewrite decomposes the 1057-line god-object Orchestrator into 5 focused components wired through a `RunContext`. The Orchestrator becomes a thin facade (< 200 lines) that creates the RunContext and delegates to PipelineLoop. Config is frozen at construction via `structuredClone` + `Object.freeze`. Errors flow via return types (discriminated unions), not exceptions, for expected outcomes. The EventBus becomes instance-scoped (not singleton), enabling future concurrent runs.

**Major new components:**
1. **RunContext** -- holds all run-scoped instances (ArtifactStore, Logger, Provider, EventBus, Config, AbortSignal)
2. **PipelineLoop** -- iterative stage sequencing, replaces recursive executeStage
3. **StageExecutor** -- execute single stage with retry, gate handling, context building
4. **FixLoopRunner** -- dedicated Tester-Coder retry loop with progressive strategy (direct-fix, replan, full-history)
5. **ArtifactStore** -- instance-scoped artifact I/O, bridge pattern for backward compatibility
6. **Coder sub-modules** -- CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner (from 1312-line monolith)

### Critical Pitfalls

1. **Singleton state contamination during ArtifactStore transition** -- Preserved code (BaseAgent) calls global `writeArtifact()` while rewritten code uses the ArtifactStore instance, causing artifacts to land in different directories. Prevention: bridge pattern where ArtifactStore wraps the global, never runs parallel. Test both read paths see same data.

2. **Test suite becomes a lie** -- Mock-heavy tests with `as any` casts create a parallel universe. Rewritten modules pass unit tests while integration breaks silently. Prevention: fix `as any` casts first, create typed mock factories, add canary integration test that uses real everything except LLM.

3. **Rewriting the orchestrator while it orchestrates everything** -- The hub has the most dependencies. Rewriting it early means building against old interfaces; rewriting it late means adapting to every change. Prevention: rewrite it LAST, or in two surgical phases (iterative loop first, then adapt to new components).

4. **Phantom interface drift** -- TypeScript types match but runtime behavior changes (error propagation paths, timing, return semantics). Compiler sees no error; preserved modules break at runtime. Prevention: behavioral contract tests before rewrite, E2E tests after every module change.

5. **Resume contract breakage** -- Old `pipeline-state.json` files become incompatible with new ArtifactStore paths. Prevention: document resume contract, add version field to state file, write resume integration tests BEFORE artifact layer rewrite.

## Implications for Roadmap

Based on dependency analysis across all four research streams, here is the recommended phase structure:

### Phase 1: Test Infrastructure Hardening
**Rationale:** All research streams agree: the test suite must be trustworthy BEFORE any rewrite begins. Pitfall 3 (test suite lies) is the meta-risk that makes all other pitfalls invisible. This phase has zero dependencies and unblocks everything.
**Delivers:** Typed mock factories (`createTestContext()`, `createMockProvider()`), elimination of all `as any` casts in test files, canary integration test, resume integration tests.
**Addresses:** Resume integration test gap (table stake #8), `as any` test fragility.
**Avoids:** Pitfall 3 (test suite becomes a lie), Pitfall 9 (resume contract breakage -- tests written before artifact rewrite).

### Phase 2: Foundation Layer (ArtifactStore + Error Handling + Config Freeze)
**Rationale:** ArtifactStore is the dependency everything else needs. Error handling (Result type + silent catch elimination) and config freeze are low-risk, high-value changes with no cross-dependencies. All three researchers (STACK, FEATURES, ARCHITECTURE) identify these as the foundational layer.
**Delivers:** `ArtifactStore` class with bridge pattern, `Result<T, E>` type, silent catch elimination (16 catches across evolution engine + validator), `structuredClone` config freeze, `RunContext` factory.
**Addresses:** Table stakes #1 (error visibility), #3 (artifact isolation), #7 (immutable config).
**Avoids:** Pitfall 2 (singleton state contamination -- bridge pattern), Pitfall 7 (silent catch migration -- enforce policy from day one).

### Phase 3: Execution Engine (Iterative Loop + StageExecutor + FixLoopRunner)
**Rationale:** Depends on RunContext and ArtifactStore existing. This is the structural core of the rewrite -- converting recursive execution to iterative, extracting the Tester-Coder fix loop, and introducing discriminated union stage results. Graceful shutdown depends on the iterative loop having a clean exit point.
**Delivers:** `PipelineLoop`, `StageExecutor`, `FixLoopRunner`, `GateHandler`, `ShutdownCoordinator`, iterative execution with `StageOutcome` union.
**Addresses:** Table stakes #4 (iterative execution), #5 (graceful shutdown), #2 (finite retry + circuit breaker).
**Avoids:** Pitfall 1 (phantom interface drift -- behavioral contract tests from Phase 1), Pitfall 4 (orchestrator as hub -- building components bottom-up before touching orchestrator), Pitfall 10 (event bus subscriber drift).

### Phase 4: Coder Agent Decomposition
**Rationale:** Architecturally independent from the orchestration rewrite. Can technically run in parallel with Phase 3, but sequencing after Phase 3 means the new CoderAgent can use StageExecutor patterns. The 1312-line monolith is the single largest maintenance burden.
**Delivers:** `CoderPlanner`, `CoderBuilder`, `BuildVerifier`, `SmokeRunner`, rewritten `CoderAgent` facade (~200 lines).
**Addresses:** Coder split requirement from PROJECT.md, Coder shell command test gap (table stake from Active requirements).
**Avoids:** Pitfall 5 (import extension breakage -- keep `coder.ts` barrel file), Pitfall 11 (circular barrel imports -- sub-modules import specific files).

### Phase 5: Orchestrator Facade + Logging Cleanup
**Rationale:** The orchestrator is rewritten LAST, after all components it depends on are stable. By this point, it becomes a thin wiring layer (< 200 lines) that creates RunContext and delegates to PipelineLoop. Logging cleanup (30+ console.log calls) is mechanical work that fits here.
**Delivers:** Rewritten `Orchestrator` (< 200 lines), unified logging (all output through Logger), EventBus instance-scoping (no more singleton).
**Addresses:** Table stake #6 (unified logging), god-object decomposition.
**Avoids:** Pitfall 4 (rewriting the hub -- all dependencies are now stable), Pitfall 8 (config mutation leaks -- already fixed by Phase 2 config freeze).

### Phase Ordering Rationale

- **Phase 1 before everything**: You cannot safely rewrite code if the tests are lying. Every researcher flagged test quality as a prerequisite.
- **Phase 2 before Phase 3**: The iterative execution loop needs RunContext and ArtifactStore to exist. Error handling patterns must be established before writing new code that handles errors.
- **Phase 3 before Phase 5**: The orchestrator facade cannot be written until the components it delegates to (PipelineLoop, StageExecutor, FixLoopRunner) exist.
- **Phase 4 is semi-independent**: It depends on Phase 2 (ArtifactStore) but not on Phase 3. Could run in parallel with Phase 3 if resources allow.
- **Phase 5 is the capstone**: Everything wires together. The orchestrator is the last piece because it touches everything.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (ArtifactStore bridge pattern):** The backward-compatibility shim between ArtifactStore instance and global functions needs careful design. Research the exact call sites in BaseAgent and preserved modules to verify the bridge covers all paths.
- **Phase 3 (FixLoopRunner progressive strategy):** The current Tester-Coder fix loop has undocumented progressive retry logic (rounds 1-2 direct-fix, round 3 replan, rounds 4-5 full-history). This behavior must be fully understood before extraction.

Phases with standard patterns (skip research-phase):
- **Phase 1 (test infrastructure):** Well-documented Vitest patterns. Typed mock factories are standard practice.
- **Phase 4 (Coder split):** Straightforward module extraction. The sub-module boundaries are already identified in ARCHITECTURE.md.
- **Phase 5 (Orchestrator facade):** By this point, all components exist. The facade is just wiring.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations use existing tech or TypeScript built-ins. Only optional new dep (cockatiel) has a hand-roll fallback. Sources verified. |
| Features | MEDIUM-HIGH | Table stakes well-grounded in LangGraph/CrewAI comparison and codebase analysis. Differentiators are judgment calls. |
| Architecture | HIGH | Component boundaries derived directly from codebase analysis. Patterns (RunContext, iterative loop, discriminated unions) are textbook. |
| Pitfalls | HIGH | All critical pitfalls grounded in specific code locations (line numbers, module names). Prevention strategies are concrete. |

**Overall confidence:** HIGH

### Gaps to Address

- **Cockatiel version verification:** STACK.md notes MEDIUM confidence on exact version. Verify `cockatiel@^3.2` is current before Phase 3. Alternatively, hand-roll retry+circuit-breaker (~100 lines).
- **Zod v4 schema patterns:** Pitfall 6 warns about v3/v4 incompatibility in online resources. Any new Zod schemas in the rewrite must be verified against v4 docs specifically.
- **Resume state file migration:** No version field exists in current `pipeline-state.json`. Need to decide: add migration logic, or simply invalidate old state files on v2 upgrade. Decision needed in Phase 2 planning.
- **EventBus event sequence contract:** No documentation exists for the expected event emission order. Before Phase 3 (which changes emission points), capture the current sequence as a test fixture.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/core/orchestrator.ts`, `src/core/artifact.ts`, `src/core/event-bus.ts`, `src/agents/coder.ts`
- Project documents: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`
- [Cockatiel resilience library](https://github.com/connor4312/cockatiel) -- retry, circuit breaker, timeout
- [Strangler Fig Pattern - Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html) -- incremental rewrite strategy

### Secondary (MEDIUM confidence)
- [LangGraph Error Handling and Retry Policies](https://deepwiki.com/langchain-ai/langgraph/3.7-error-handling-and-retry-policies) -- retry patterns comparison
- [AgentTrace: Structured Logging for Agent Systems](https://arxiv.org/abs/2602.10133) -- observability patterns
- [Circuit Breaker Pattern in Node.js](https://dev.to/wallacefreitas/circuit-breaker-pattern-in-nodejs-and-typescript-enhancing-resilience-and-stability-bfi) -- implementation reference
- [TypeScript at Scale in 2026](https://blog.logrocket.com/typescript-at-scale-2026/) -- architecture patterns
- [DI Benchmark: Vanilla vs Frameworks](https://blog.vady.dev/di-benchmark-vanilla-registrycomposer-typed-inject-tsyringe-inversify-nestjs) -- DI decision support
- [AI Agent Error Handling Best Practices 2025](https://fast.io/resources/ai-agent-error-handling/) -- error classification patterns
- [Agents At Work: 2026 Playbook for Reliable Agentic Workflows](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) -- production reliability

### Tertiary (LOW confidence)
- [AI Agent Frameworks comparison (2026)](https://designrevision.com/blog/ai-agent-frameworks) -- general landscape, not directly applicable
- [Effect-TS Documentation](https://effect.website/) -- evaluated and rejected

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
