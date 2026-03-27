# Phase 2: Foundation Layer - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Core building blocks for the v2 rewrite: instance-scoped artifact I/O via ArtifactStore, explicit error handling via Result<T,E>, immutable config via freeze, and RunContext per-run bundle. All existing callers migrated. 18 silent catches replaced with typed error handling.

</domain>

<decisions>
## Implementation Decisions

### ArtifactStore Design
- **D-01:** ArtifactStore is a class instantiated per run, replacing the global `baseDir`/`currentRunDir` module state in `artifact.ts`.
- **D-02:** Global shim functions (`writeArtifact`, `readArtifact`, `artifactExists`) are **deleted entirely** — not deprecated, not kept as bridge. All 25 callers across the codebase are migrated to use `ctx.store` via RunContext injection.
- **D-03:** This means BaseAgent is **unFROZEN** for this phase — its constructor changes to accept RunContext.

### Result<T,E> Adoption
- **D-04:** ~50-line `Result<T, E>` type implemented as discriminated union (`{ ok: true, value: T } | { ok: false, error: E }`).
- **D-05:** Adoption scope: **all new modules AND all 18 existing silent catches migrated**. Most aggressive/consistent approach.
- **D-06:** Existing throw-on-error patterns in preserved modules (pipeline.ts state machine, etc.) remain unchanged unless they contain silent catches.

### Silent Catch Treatment (18 total)
- **D-07:** Three-tier classification:
  - **Tier 1 — Must-have files (prompt files):** Throw exception. Missing prompt = broken agent, must not silently degrade.
  - **Tier 2 — Optional files (constitution, skills):** `logger.warn()` + skip. File absence is expected in some configurations.
  - **Tier 3 — Possibly-damaged data (manifests, artifacts):** Return `Result.err('unreadable')`. Caller decides how to handle.
- **D-08:** Specific mapping:
  - Context Manager prompt file (line 22): Tier 1 → throw in production, warn in dev
  - Context Manager constitution (line 30): Tier 2 → logger.warn + skip
  - Context Manager skills (line 50): Tier 2 → logger.warn (already does console.warn, migrate to logger)
  - Evolution Engine 10 catches: Tier 2/3 depending on whether data or optional file
  - Validator 7 catches: Tier 3 → return Result.err with 'unreadable' status

### RunContext Design
- **D-09:** RunContext bundles: ArtifactStore, Logger, Provider, EventBus, Config (frozen), AbortSignal.
- **D-10:** **Full chain injection** — RunContext is passed through Orchestrator → AgentFactory → BaseAgent → all downstream. Every module has explicit access.
- **D-11:** BaseAgent constructor changes from `(stage, provider, logger)` to accept RunContext. This is a **conscious unFREEZE** of BaseAgent for this phase. All 13 Agent constructors and agent-factory updated.
- **D-12:** No global shim coexistence — full injection means globals are removed, not deprecated.

### Config Freeze
- **D-13:** Config frozen via `structuredClone(rawConfig)` + `Object.freeze()` before pipeline execution. Any mutation attempt throws at runtime.
- **D-14:** The one known mutation site (`enableEvolution()` in orchestrator.ts line 939) must be restructured — evolution enablement becomes a parameter at construction time, not a runtime mutation.

### Claude's Discretion
- Result<T,E> internal implementation details (type definition style)
- ArtifactStore internal API surface (method names, signatures beyond read/write/exists)
- RunContext construction pattern (plain object vs class vs factory function)
- Test structure for new modules

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Artifact Subsystem (25 callers to migrate)
- `src/core/artifact.ts` — Current global state implementation (baseDir, currentRunDir, 6 exported functions)
- `src/core/types.ts` — PipelineConfig, StageConfig, AgentContext interfaces

### Error Handling Targets
- `src/evolution/engine.ts` — 10 silent catch blocks (lines 177, 207, 225, 238, 243, 253, 283, 303, 354+)
- `src/agents/validator.ts` — 7 silent catch blocks (lines 105, 124, 142, 174, 189, 199, 211)
- `src/core/context-manager.ts` — 3 silent catches (lines 22, 30, 50-63)

### Modules Being Modified (unFROZEN)
- `src/core/agent.ts` — BaseAgent constructor will change to accept RunContext
- `src/core/agent-factory.ts` — createAgent will pass RunContext
- `src/agents/*.ts` — All 13 agent constructors updated
- `src/core/event-bus.ts` — EventBus changes from singleton to instance (bundled in RunContext)

### Config Mutation Site
- `src/core/orchestrator.ts` lines 939-944 — enableEvolution() mutates config at runtime

### Phase 1 Test Infrastructure
- `src/__tests__/test-helpers.ts` — Mock factories (createMockProvider, createMockLogger) will need RunContext equivalents
- `src/__tests__/e2e-canary.test.ts` — Canary test must be updated to use RunContext pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `artifact.ts` has clean read/write/exists API — ArtifactStore can keep the same method signatures, just instance-scoped
- `EventBus` class already exists with typed events — just remove the singleton export, instantiate per-run
- `RetryingProvider` decorator pattern — can wrap Provider inside RunContext

### Established Patterns
- `fileParallelism: false` in vitest config — currently needed because artifact globals. After ArtifactStore, tests could potentially run in parallel (but not a Phase 2 goal)
- Agent construction: `new AgentClass(stage, provider, logger)` — will change to include RunContext
- Config loaded once in Orchestrator constructor via `yaml.load()` — freeze point is right after load

### Integration Points
- 25 files import from `artifact.js` — all must be migrated to use RunContext.store
- `cli-progress.ts` subscribes to singleton eventBus — must receive EventBus instance instead
- MCP tools in `mcp/tools.ts` subscribe to eventBus — need instance access
- `context-manager.ts` uses artifact functions directly — must accept store via parameter or RunContext

</code_context>

<specifics>
## Specific Ideas

- User chose the most aggressive approach on every decision: full chain injection (not shim), delete globals (not deprecate), migrate all 18 catches (not just new code). This signals a preference for clean breaks over gradual migration.
- BaseAgent is consciously unFROZEN — user accepts the 13-agent constructor change cost for long-term cleanliness.
- The enableEvolution() runtime mutation is the only known config mutation site — restructure it, don't add freeze exceptions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-foundation-layer*
*Context gathered: 2026-03-27*
