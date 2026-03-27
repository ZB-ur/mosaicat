# Phase 2: Foundation Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 02-foundation-layer
**Areas discussed:** ArtifactStore bridge design, Result<T,E> adoption scope, Silent catch treatment, RunContext passing pattern

---

## ArtifactStore Bridge Design

| Option | Description | Selected |
|--------|-------------|----------|
| Global shim functions | Keep writeArtifact/readArtifact as exports, internally delegate to thread-local ArtifactStore instance. Zero changes to callers. | |
| Inject into BaseAgent constructor | Add ArtifactStore as 4th param to BaseAgent. Cleaner but requires touching agent-factory and all 13 agents. | |
| Hybrid: shim now, inject in Phase 5 | Phase 2 uses global shim, Phase 5 adds constructor injection. Two-step migration. | |

**User's choice:** Global shim functions (initially). Later revised — after RunContext discussion, user chose full chain injection + delete globals entirely. See RunContext section.
**Notes:** User chose shim first for minimal change, but once RunContext full injection was selected, the shim became unnecessary. Final decision: no shim, no globals, all 25 callers migrated.

---

## Result<T,E> Adoption Scope

| Option | Description | Selected |
|--------|-------------|----------|
| New modules only | ArtifactStore, RunContext etc return Result. Old code keeps throwing. | |
| Artifact I/O only | Only readArtifact/readManifest return Result. Minimal surface area. | |
| New modules + migrate silent catches | New code uses Result AND migrate 18 silent catches to Result. Most aggressive. | ✓ |

**User's choice:** New modules + migrate all 18 silent catches
**Notes:** User asked for clarification on the differences between options. After explanation of throw-on-error vs Result pattern with code examples and trade-off table, chose the most thorough approach.

---

## Silent Catch Treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Three-tier classification | Must-have files→throw, Optional files→warn+skip, Damaged data→Result.err('unreadable') | ✓ |
| Uniform logger.warn + fallback | All 18 changed to logger.warn + reasonable defaults. Simple but may mask real issues. | |
| All Result + caller decides | All 18 return Result, caller chooses warn/throw/ignore. Most flexible but most caller code. | |

**User's choice:** Three-tier classification
**Notes:** No additional clarification needed.

---

## RunContext Passing Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Only Orchestrator holds | RunContext created at Orchestrator, sets global shim. Agents unaware. Phase 5 changes later. | |
| Full chain injection | RunContext passed through entire chain. BaseAgent constructor changes. Most invasive but cleanest. | ✓ |
| Hybrid: new modules inject, old shim | New modules (StageExecutor) get RunContext. Old modules use shim. Two styles coexist. | |

**User's choice:** Full chain injection
**Notes:** User asked for detailed comparison of readability/maintainability across all three options. After receiving comparison table covering: reading new code, reading old code, grep-ability, and Phase 5 final state — chose full injection despite it requiring BaseAgent unFREEZE. Values long-term cleanliness over incremental safety.

### Follow-up: Global shim retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as @deprecated transition | Global functions stay but marked deprecated. Safety net for missed callers. | |
| Delete entirely | No globals. All 25 callers must be migrated. Compile errors catch any missed migration. | ✓ |

**User's choice:** Delete entirely
**Notes:** Consistent with user's preference for clean breaks throughout this discussion.

---

## Claude's Discretion

- Result<T,E> internal implementation details
- ArtifactStore API surface beyond read/write/exists
- RunContext construction pattern
- Test structure for new modules

## Deferred Ideas

None — discussion stayed within phase scope.
