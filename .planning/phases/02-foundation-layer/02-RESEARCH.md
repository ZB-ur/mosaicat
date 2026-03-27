# Phase 2: Foundation Layer - Research

**Researched:** 2026-03-27
**Domain:** TypeScript module architecture -- instance scoping, Result types, immutable config, dependency injection
**Confidence:** HIGH

## Summary

Phase 2 replaces global mutable state in the Mosaicat engine with instance-scoped, explicitly-wired alternatives. The work spans four interconnected domains: (1) ArtifactStore class replacing global `baseDir`/`currentRunDir` in `artifact.ts`, (2) Result<T,E> discriminated union for error handling, (3) frozen config via `structuredClone` + `Object.freeze`, and (4) RunContext bundle threading through the entire call chain.

The user chose the most aggressive approach on every decision: full chain injection (no shim), delete globals (no deprecation), migrate all 18 silent catches, and consciously unfreeze BaseAgent. This means the migration surface is large (25+ files importing artifact.ts, 17 files importing event-bus.ts singleton, 13 agent constructors) but the end state is clean -- no legacy compatibility code to maintain.

**Primary recommendation:** Implement bottom-up: Result type first (leaf, no dependencies), then ArtifactStore (used by everything), then config freeze (simple), then RunContext bundle (ties everything together), then migrate all callers, and finally fix silent catches. The canary E2E test must be updated last as the integration validation gate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** ArtifactStore is a class instantiated per run, replacing the global `baseDir`/`currentRunDir` module state in `artifact.ts`.
- **D-02:** Global shim functions (`writeArtifact`, `readArtifact`, `artifactExists`) are **deleted entirely** -- not deprecated, not kept as bridge. All 25 callers across the codebase are migrated to use `ctx.store` via RunContext injection.
- **D-03:** This means BaseAgent is **unFROZEN** for this phase -- its constructor changes to accept RunContext.
- **D-04:** ~50-line `Result<T, E>` type implemented as discriminated union (`{ ok: true, value: T } | { ok: false, error: E }`).
- **D-05:** Adoption scope: **all new modules AND all 18 existing silent catches migrated**. Most aggressive/consistent approach.
- **D-06:** Existing throw-on-error patterns in preserved modules (pipeline.ts state machine, etc.) remain unchanged unless they contain silent catches.
- **D-07:** Three-tier classification for silent catches (Tier 1: throw, Tier 2: warn+skip, Tier 3: Result.err).
- **D-08:** Specific tier mapping for each catch site (see CONTEXT.md for full mapping).
- **D-09:** RunContext bundles: ArtifactStore, Logger, Provider, EventBus, Config (frozen), AbortSignal.
- **D-10:** Full chain injection -- RunContext is passed through Orchestrator -> AgentFactory -> BaseAgent -> all downstream.
- **D-11:** BaseAgent constructor changes from `(stage, provider, logger)` to accept RunContext.
- **D-12:** No global shim coexistence -- full injection means globals are removed, not deprecated.
- **D-13:** Config frozen via `structuredClone(rawConfig)` + `Object.freeze()` before pipeline execution.
- **D-14:** The `enableEvolution()` mutation in orchestrator.ts must be restructured -- evolution enablement becomes a parameter at construction time.

### Claude's Discretion
- Result<T,E> internal implementation details (type definition style)
- ArtifactStore internal API surface (method names, signatures beyond read/write/exists)
- RunContext construction pattern (plain object vs class vs factory function)
- Test structure for new modules

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERR-01 | Replace 9 silent catches in Evolution Engine with `logger.warn()` + typed fallback | Exact catch locations mapped (lines 177, 207, 225, 238, 243, 253, 283, 303, 354). Tier 2/3 classification per D-07/D-08. |
| ERR-02 | Replace 7 silent catches in Validator with explicit "unreadable" status | Exact catch locations mapped (lines 105, 124, 142, 174, 189, 199, 211). All are Tier 3 -- return Result.err. |
| ERR-03 | Implement `Result<T, E>` type (~50 lines) | Discriminated union pattern well-understood. TypeScript 5.9 supports all needed features. |
| ERR-04 | Context Manager fail-fast for missing prompt files (prod) / warn (dev) | Three catch blocks in context-manager.ts (lines 22, 30, 50-63). Tier 1/2/2 classification. |
| STATE-01 | Implement ArtifactStore class replacing artifact.ts globals | Current API (6 functions + 2 mutable globals) fully documented. 25 import sites identified. |
| STATE-02 | ArtifactStore bridge pattern for preserved modules | **SUPERSEDED by D-02**: User chose to delete globals entirely and migrate all callers. No bridge needed. BaseAgent unFROZEN. |
| STATE-03 | Config freeze via structuredClone + Object.freeze | One mutation site identified: `enableEvolution()` at orchestrator.ts:938-944. Must restructure. |
| STATE-04 | Implement RunContext bundling ArtifactStore/Logger/Provider/EventBus/Config/AbortSignal | RunContext design locked per D-09/D-10/D-11. Full chain injection. |
| SEC-01 | SecurityAuditor excludes .env file contents from scanning | Line 119 in security-auditor.ts includes `.env` in scan extensions. Must read only existence, not contents. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Language -- discriminated unions, strict mode | Already in project |
| Vitest | 4.1.0 | Test runner | Already in project |
| zod | 4.3.6 | Schema validation | Already in project, used for manifest validation |

### Supporting
No new libraries needed. This phase is pure TypeScript architecture -- Result types, classes, Object.freeze, structuredClone are all built-in.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Result<T,E> | neverthrow, oxide.ts | User locked D-04: ~50 lines, no dependency. Correct choice for this codebase size. |
| Object.freeze | Immer, deep-freeze-strict | structuredClone+freeze is zero-dependency, sufficient for one-level-deep config |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  core/
    result.ts              # NEW: Result<T,E> type + helpers
    artifact-store.ts      # NEW: ArtifactStore class (replaces artifact.ts globals)
    run-context.ts         # NEW: RunContext type + createRunContext factory
    artifact.ts            # MODIFIED: remove globals, keep ArtifactStore-internal logic or delete
    agent.ts               # MODIFIED: BaseAgent accepts RunContext
    agent-factory.ts       # MODIFIED: createAgent receives RunContext
    context-manager.ts     # MODIFIED: accept store param, tier 1/2 error handling
    orchestrator.ts        # MODIFIED: creates RunContext, passes it down
    event-bus.ts           # MODIFIED: remove singleton export
    manifest.ts            # MODIFIED: accept store param instead of importing globals
  agents/
    *.ts                   # MODIFIED: all 13 constructors updated
  evolution/
    engine.ts              # MODIFIED: 10 silent catches replaced
  __tests__/
    test-helpers.ts        # MODIFIED: createTestRunContext() factory
```

### Pattern 1: Result<T, E> Discriminated Union
**What:** Lightweight error-as-value type for operations that can fail without throwing.
**When to use:** Tier 3 operations (possibly-damaged data), new modules that may fail.
**Example:**
```typescript
// src/core/result.ts
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Usage convenience
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}
```

### Pattern 2: ArtifactStore Class (Instance-Scoped)
**What:** Encapsulates artifact I/O with a per-run root directory.
**When to use:** All artifact read/write/exists operations.
**Example:**
```typescript
// src/core/artifact-store.ts
import fs from 'node:fs';
import path from 'node:path';

export class ArtifactStore {
  readonly runDir: string;

  constructor(baseDir: string, runId: string) {
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

### Pattern 3: RunContext Bundle
**What:** Immutable bundle of per-run dependencies passed through the call chain.
**When to use:** Every module that needs access to run-scoped resources.
**Example:**
```typescript
// src/core/run-context.ts
import type { ArtifactStore } from './artifact-store.js';
import type { Logger } from './logger.js';
import type { LLMProvider } from './llm-provider.js';
import type { EventBus } from './event-bus.js';
import type { PipelineConfig } from './types.js';

export interface RunContext {
  readonly store: ArtifactStore;
  readonly logger: Logger;
  readonly provider: LLMProvider;
  readonly eventBus: EventBus;
  readonly config: Readonly<PipelineConfig>;
  readonly signal: AbortSignal;
}
```

### Pattern 4: Config Freeze
**What:** Deep-clone then freeze config before pipeline execution.
**When to use:** Immediately after loading config from YAML.
**Example:**
```typescript
function freezeConfig(raw: PipelineConfig): Readonly<PipelineConfig> {
  const frozen = structuredClone(raw);
  return Object.freeze(frozen) as Readonly<PipelineConfig>;
}
```
**Note:** `Object.freeze` is shallow. For this codebase, the config nesting is 2 levels deep at most. `structuredClone` creates an independent copy; `Object.freeze` prevents top-level mutation. Nested objects could still be mutated without deep freeze, but the only known mutation site (`enableEvolution()`) operates on the top level. If deeper protection is needed, a recursive freeze helper is ~10 lines.

### Pattern 5: enableEvolution Restructure
**What:** Move evolution enablement from runtime mutation to construction-time parameter.
**When to use:** When creating the Orchestrator.
**Example:**
```typescript
// Before (mutates frozen config -- will throw):
// orchestrator.enableEvolution();

// After: pass as construction option
class Orchestrator {
  constructor(
    private config: Readonly<PipelineConfig>,
    private options: { enableEvolution?: boolean },
  ) {}

  // Use this.options.enableEvolution instead of this.config.evolution.enabled
}
```

### Anti-Patterns to Avoid
- **Global mutable state:** The entire point of this phase is to eliminate `baseDir`/`currentRunDir` globals. Do not introduce new module-level mutable state.
- **Optional RunContext:** Do not make RunContext optional in constructors with fallback to globals. The migration is all-or-nothing per D-12.
- **Result everywhere:** Do not convert throw-based error handling in pipeline.ts, ClarificationNeeded, etc. Only the 18 identified silent catches and new modules use Result (D-06).
- **Deep freeze over-engineering:** Do not implement a recursive deep-freeze utility unless a specific nested mutation is found beyond `enableEvolution()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deep cloning | Custom recursive clone | `structuredClone()` (built-in) | Handles circular refs, typed arrays, etc. |
| Schema validation | Manual type checks | `zod` (already in project) | Already used for manifests, consistent |
| Event system | Custom pub/sub | `eventemitter3` (already in project) | EventBus class already exists, just remove singleton |

**Key insight:** This phase adds no new dependencies. Everything needed -- discriminated unions, Object.freeze, structuredClone, AbortSignal -- is built into TypeScript/Node.js.

## Common Pitfalls

### Pitfall 1: Object.freeze is Shallow
**What goes wrong:** Nested config objects (e.g., `config.github.enabled`) remain mutable even after `Object.freeze(config)`.
**Why it happens:** `Object.freeze` only freezes own properties at the top level.
**How to avoid:** For this codebase, the only known mutation site is `enableEvolution()` which is being restructured. If deeper freeze is needed, use a recursive freeze:
```typescript
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') deepFreeze(val as object);
  }
  return Object.freeze(obj);
}
```
**Warning signs:** Runtime test that mutates `config.stages.researcher.gate = 'manual'` succeeds unexpectedly.

### Pitfall 2: Circular Dependency in RunContext
**What goes wrong:** RunContext contains EventBus, EventBus handlers reference RunContext, creating import cycles.
**Why it happens:** RunContext is a God object that bundles everything.
**How to avoid:** RunContext should be a plain interface (not a class), defined in its own file with no implementation imports. Modules import the type, not the implementation. The factory function lives separately.
**Warning signs:** `TypeError: Cannot read property of undefined` at module load time.

### Pitfall 3: Forgetting to Update Test Mocks
**What goes wrong:** Tests break because mock factories still create the old `(stage, provider, logger)` constructor signature.
**Why it happens:** 13 agent constructors change, plus test-helpers.ts, plus canary E2E mock.
**How to avoid:** Update `createTestContext()` in test-helpers.ts to return a `RunContext` first, then update all test files.
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'store')` in tests.

### Pitfall 4: Manifest readManifest/writeManifest Still Import artifact.ts
**What goes wrong:** `manifest.ts` imports `writeArtifact`/`readArtifact` from `artifact.ts`. After globals are deleted, these imports break.
**Why it happens:** `manifest.ts` is a transitive dependency -- validator.ts and other agents call `readManifest()` which internally calls `readArtifact()`.
**How to avoid:** Either (a) make `readManifest`/`writeManifest` accept an ArtifactStore parameter, or (b) restructure so manifest module uses store from RunContext.
**Warning signs:** Compilation error in manifest.ts after artifact.ts globals removed.

### Pitfall 5: EventBus Singleton Used in 17 Files
**What goes wrong:** Removing `export const eventBus = new EventBus()` breaks 17 import sites simultaneously.
**Why it happens:** The singleton is deeply embedded -- agents, orchestrator, cli-progress, issue-manager, proposal-handler all import it.
**How to avoid:** The EventBus instance lives in RunContext. Agents access it via `this.ctx.eventBus`. Non-agent code (cli-progress, mcp/tools) receives the instance as a parameter when subscribing.
**Warning signs:** `eventBus is not defined` errors across multiple files.

### Pitfall 6: SecurityAuditor scanFilesForPatterns Reads .env Contents
**What goes wrong:** SEC-01 requires only checking `.env` existence, not reading contents. Current code reads `.env` file contents and scans them with regex patterns.
**Why it happens:** `.env` is in the extension allowlist at line 119.
**How to avoid:** Remove `.env` from the scan extension list. Add a separate existence check that reports `.env` files found without reading their contents.
**Warning signs:** `.env` file content appearing in security report output.

## Code Examples

### Migration: BaseAgent Constructor
```typescript
// BEFORE (current)
export abstract class BaseAgent {
  constructor(stage: StageName, provider: LLMProvider, logger: Logger) {
    this.stage = stage;
    this.provider = provider;
    this.logger = logger;
  }

  protected writeOutput(name: string, content: string): void {
    writeArtifact(name, content);  // global function
    eventBus.emit('artifact:written', ...);  // singleton
  }
}

// AFTER (Phase 2)
export abstract class BaseAgent {
  protected readonly ctx: RunContext;
  readonly stage: StageName;

  constructor(stage: StageName, ctx: RunContext) {
    this.stage = stage;
    this.ctx = ctx;
  }

  // Convenience accessors (reduce verbosity in agents)
  protected get provider(): LLMProvider { return this.ctx.provider; }
  protected get logger(): Logger { return this.ctx.logger; }

  protected writeOutput(name: string, content: string): void {
    this.ctx.store.write(name, content);
    this.ctx.eventBus.emit('artifact:written', this.stage, name, content.length);
  }
}
```

### Migration: Agent Factory
```typescript
// BEFORE
export function createAgent(
  stage: StageName,
  provider: LLMProvider,
  logger: Logger,
  _autonomy?: AgentAutonomyConfig,
  interactionHandler?: InteractionHandler,
): BaseAgent { ... }

// AFTER
export function createAgent(
  stage: StageName,
  ctx: RunContext,
  autonomy?: AgentAutonomyConfig,
  interactionHandler?: InteractionHandler,
): BaseAgent { ... }
```

### Migration: Silent Catch (Tier 3 -- Validator)
```typescript
// BEFORE (validator.ts line 105)
try {
  const manifest = readManifest<ComponentsManifest>('components.manifest.json');
  // ... use manifest
} catch {
  missing.push('components.manifest.json (unreadable)');
}

// AFTER (using Result)
import { type Result, ok, err } from '../core/result.js';

function readManifestSafe<T>(store: ArtifactStore, name: string): Result<T, string> {
  try {
    const content = store.read(name);
    const parsed = JSON.parse(content) as unknown;
    const schema = MANIFEST_SCHEMAS[name];
    if (schema) schema.parse(parsed);
    return ok(parsed as T);
  } catch (e) {
    return err(`${name}: ${e instanceof Error ? e.message : 'unreadable'}`);
  }
}

// Caller
const manifestResult = readManifestSafe<ComponentsManifest>(ctx.store, 'components.manifest.json');
if (!manifestResult.ok) {
  missing.push(`components.manifest.json (${manifestResult.error})`);
} else {
  const manifest = manifestResult.value;
  // ... use manifest
}
```

### Migration: Silent Catch (Tier 1 -- Context Manager prompt)
```typescript
// BEFORE (context-manager.ts line 22)
try {
  systemPrompt = fs.readFileSync(config.prompt_file, 'utf-8');
} catch {
  systemPrompt = `You are the ${config.name} agent.`;
}

// AFTER
const isDev = process.env.NODE_ENV !== 'production';
try {
  systemPrompt = fs.readFileSync(config.prompt_file, 'utf-8');
} catch (e) {
  if (isDev) {
    ctx.logger.pipeline('warn', 'context:prompt-missing', {
      stage: task.stage,
      file: config.prompt_file,
      error: e instanceof Error ? e.message : String(e),
    });
    systemPrompt = `You are the ${config.name} agent.`;
  } else {
    throw new Error(`Required prompt file missing: ${config.prompt_file}`);
  }
}
```

### Migration: SEC-01 -- SecurityAuditor .env Handling
```typescript
// BEFORE (line 119)
if (!['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.env']
  .some(ext => entry.name.endsWith(ext))) continue;

// AFTER -- remove .env from content scan, add existence-only check
if (!['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml']
  .some(ext => entry.name.endsWith(ext))) continue;

// Separate method for .env existence check
private checkEnvFileExistence(codeDir: string): string[] {
  const envFiles: string[] = [];
  // Walk directory tree, record .env file paths without reading contents
  this.walkForEnvFiles(codeDir, codeDir, envFiles);
  return envFiles;
}
```

## Caller Migration Inventory

### artifact.ts Global Importers (25 files -- all must migrate to ctx.store)

**Core modules (8):**
| File | Functions Used | Migration |
|------|---------------|-----------|
| `core/agent.ts` | writeArtifact, readArtifact, artifactExists | Use ctx.store methods |
| `core/context-manager.ts` | readArtifact, artifactExists | Accept store as param or RunContext |
| `core/manifest.ts` | writeArtifact, readArtifact | Accept store as param |
| `core/orchestrator.ts` | artifactExists, readArtifact, writeArtifact, initArtifactsDir, getArtifactsDir | Use ctx.store, create store in orchestrator |
| `core/snapshot.ts` | getArtifactsDir | Accept store/dir as param |
| `core/pr-body-generator.ts` | getArtifactsDir | Accept dir as param |
| `core/artifact-presenter.ts` | getArtifactsDir | Accept dir as param |
| `core/refine-runner.ts` | initArtifactsDir, findLatestRun, artifactExists, readArtifact, getArtifactsDir | Accept store or create its own |

**Agent modules (8):**
| File | Functions Used | Migration |
|------|---------------|-----------|
| `agents/validator.ts` | artifactExists | Via ctx.store |
| `agents/coder.ts` | readArtifact, artifactExists, getArtifactsDir | Via ctx.store |
| `agents/tester.ts` | readArtifact, artifactExists, getArtifactsDir | Via ctx.store |
| `agents/ui-designer.ts` | readArtifact, artifactExists, getArtifactsDir | Via ctx.store |
| `agents/security-auditor.ts` | getArtifactsDir | Via ctx.store |
| `agents/qa-lead.ts` | getArtifactsDir | Via ctx.store |
| `agents/refine-agent.ts` | readArtifact, artifactExists, getArtifactsDir | Via ctx.store |

**Evolution (1):**
| File | Functions Used | Migration |
|------|---------------|-----------|
| `evolution/engine.ts` | getArtifactsDir | Accept store as param or via RunContext |

**Infrastructure (2):**
| File | Functions Used | Migration |
|------|---------------|-----------|
| `mcp/tools.ts` | getArtifactsDir | Receive store from RunManager |

**Tests (6):**
| File | Functions Used | Migration |
|------|---------------|-----------|
| `__tests__/test-helpers.ts` | setBaseDir, resetBaseDir | Replace with createTestArtifactStore() |
| `__tests__/e2e-canary.test.ts` | (via mock) | Update mock to use RunContext |
| `__tests__/e2e-phase3.test.ts` | getArtifactsDir | Update to use store |
| `evolution/__tests__/engine.test.ts` | initArtifactsDir, getArtifactsDir | Update to use store |
| `agents/__tests__/validator.test.ts` | writeArtifact, initArtifactsDir, getArtifactsDir | Update to use store |
| `core/__tests__/manifest.test.ts` | initArtifactsDir | Update to use store |
| `core/__tests__/context-manager.test.ts` | writeArtifact, initArtifactsDir | Update to use store |
| `core/__tests__/orchestrator-integration.test.ts` | getArtifactsDir | Update to use store |

### EventBus Singleton Importers (17 files -- all must receive instance)

**Agents (10):** validator.ts, security-auditor.ts, intent-consultant.ts, llm-agent.ts, tester.ts, ui-designer.ts, coder.ts, qa-lead.ts, refine-agent.ts, agent.ts (BaseAgent)
**Core (5):** cli-progress.ts, orchestrator.ts, issue-manager.ts, github-interaction-handler.ts
**Evolution (1):** proposal-handler.ts
**Tests (1):** event-bus.test.ts (already uses class constructor, no change needed)

### Silent Catch Inventory (20 total, not 18 -- CONTEXT.md count needs verification)

**Evolution Engine (10 catches):**
1. Line 177: `loadState()` -- JSON parse of state file. Tier 3: return default state.
2. Line 207: `buildStageSummary` file read. Tier 2: warn + skip.
3. Line 225: `buildPipelineSummary` validation report read. Tier 2: warn + skip.
4. Line 238: `buildPipelineSummary` manifest read (inner). Tier 3: warn + skip.
5. Line 243: `buildPipelineSummary` directory read (outer). Tier 2: warn + skip.
6. Line 253: `buildPipelineSummary` log file read. Tier 2: warn + skip.
7. Line 283: `parseCandidates` JSON parse. Tier 3: already has logger.warn, just return Result.
8. Line 303: `candidateToProposal` prompt file read. Tier 2: warn + skip (prompt may not exist).
9. Line 354: `loadEvolutionConfig` YAML parse. Tier 2: return default config.
10. Line 110-114: `runAnalysis` LLM call error. Already has logger.error. Keep as-is (not silent).

**Validator (7 catches):**
1. Line 105: `checkFileIntegrity` components manifest read. Tier 3.
2. Line 124: `checkFeatureIdTraceability` PRD manifest read. Tier 3.
3. Line 142: `checkFeatureIdTraceability` inner checkLayer. Tier 3.
4. Line 174: `checkTechSpecFeatureCoverage` PRD manifest. Tier 3.
5. Line 189: `checkTechSpecFeatureCoverage` tech-spec manifest. Tier 3.
6. Line 199: `checkCodeTaskCoverage` tech-spec manifest. Tier 3.
7. Line 211: `checkCodeTaskCoverage` code manifest. Tier 3.

**Context Manager (3 catches):**
1. Line 22: Prompt file read. Tier 1: throw in prod, warn in dev.
2. Line 30: Constitution file read. Tier 2: warn + skip.
3. Line 61: Skills loading. Tier 2: already has console.warn, migrate to logger.warn.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Module-level mutable state | Instance-scoped stores | Standard practice | Enables test parallelism, eliminates race conditions |
| Silent catch blocks | Result<T,E> or explicit throw | Standard practice | Errors become visible, debuggable |
| Mutable config objects | structuredClone + Object.freeze | ES2022+ | Prevents accidental mutation |
| Singleton EventBus | Instance per run | Standard practice | Enables test isolation |

**Deprecated/outdated:**
- `setBaseDir()`/`resetBaseDir()` in artifact.ts: Will be deleted. Tests should use `new ArtifactStore(tmpDir, 'test-run')` directly.

## Open Questions

1. **artifact.ts file fate after migration**
   - What we know: All 6 exported functions will have callers migrated away. The file itself contains utility logic (findLatestRun, loadFromRun) that ArtifactStore may absorb.
   - What's unclear: Should artifact.ts be deleted entirely, or kept as a thin file re-exporting from ArtifactStore for any edge cases?
   - Recommendation: Delete entirely. Move `findLatestRun` and `loadFromRun` to ArtifactStore static methods if needed (used by resume/refine).

2. **NODE_ENV detection for Tier 1 error handling**
   - What we know: Context manager Tier 1 (prompt files) should throw in production, warn in development.
   - What's unclear: The project doesn't currently use NODE_ENV anywhere. No `.env` file or env config detected.
   - Recommendation: Use a simple boolean flag on RunContext (`devMode: boolean`) or detect from config rather than relying on NODE_ENV. This keeps the behavior explicit and testable.

3. **manifest.ts dependency on artifact.ts**
   - What we know: `readManifest`/`writeManifest` call `readArtifact`/`writeArtifact` internally.
   - What's unclear: Should manifest functions accept an ArtifactStore directly, or should they be moved into ArtifactStore?
   - Recommendation: Accept ArtifactStore as a parameter. Keep manifest.ts as a separate module (it owns schema validation logic). Signature becomes `readManifest<T>(store: ArtifactStore, name: string): T`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-03 | Result<T,E> type works correctly | unit | `npx vitest run src/core/__tests__/result.test.ts -x` | No -- Wave 0 |
| STATE-01 | ArtifactStore read/write/exists per-run | unit | `npx vitest run src/core/__tests__/artifact-store.test.ts -x` | No -- Wave 0 |
| STATE-03 | Frozen config throws on mutation | unit | `npx vitest run src/core/__tests__/config-freeze.test.ts -x` | No -- Wave 0 |
| STATE-04 | RunContext bundles all dependencies | unit | `npx vitest run src/core/__tests__/run-context.test.ts -x` | No -- Wave 0 |
| ERR-01 | Evolution engine silent catches replaced | unit | `npx vitest run src/evolution/__tests__/engine.test.ts -x` | Yes (update) |
| ERR-02 | Validator returns unreadable status | unit | `npx vitest run src/agents/__tests__/validator.test.ts -x` | Yes (update) |
| ERR-04 | Context manager fail-fast in prod | unit | `npx vitest run src/core/__tests__/context-manager.test.ts -x` | Yes (update) |
| SEC-01 | SecurityAuditor skips .env contents | unit | `npx vitest run src/agents/__tests__/security-auditor.test.ts -x` | No -- Wave 0 |
| STATE-02 | All callers migrated (no bridge) | integration | `npx vitest run src/__tests__/e2e-canary.test.ts -x` | Yes (update) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/__tests__/result.test.ts` -- covers ERR-03 (Result type correctness)
- [ ] `src/core/__tests__/artifact-store.test.ts` -- covers STATE-01 (ArtifactStore isolation)
- [ ] `src/core/__tests__/config-freeze.test.ts` -- covers STATE-03 (mutation throws)
- [ ] `src/core/__tests__/run-context.test.ts` -- covers STATE-04 (RunContext assembly)
- [ ] `src/agents/__tests__/security-auditor.test.ts` -- covers SEC-01 (.env exclusion)
- [ ] Update `src/__tests__/test-helpers.ts` -- add `createTestRunContext()` factory

## Project Constraints (from CLAUDE.md)

- **TypeScript strict mode** -- all new code must compile under `strict: true`
- **ESM only** -- use `.js` extensions on imports, `node:` prefix for builtins
- **File naming** -- `kebab-case.ts` for source, `kebab-case.test.ts` in `__tests__/`
- **Logger only** -- no `console.log` in production code, use Logger module
- **Agent pattern** -- must inherit BaseAgent, manifest auto-generated by base class
- **No direct LLM calls** -- use llm-provider interface
- **Zod for validation** -- all artifact/manifest schemas use zod
- **Workflow enforcement** -- `/start-step`, `/complete-step` lifecycle mandatory
- **Commit format** -- `<type>: <description> (#<issue>)`, issue reference required
- **EventBus format** -- `namespace:action` event names

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files listed in Canonical References
- TypeScript 5.9 built-in: structuredClone, Object.freeze, discriminated unions -- standard language features
- Vitest 4.1 -- already configured in project

### Secondary (MEDIUM confidence)
- Result<T,E> pattern: well-established TypeScript community pattern, multiple npm packages (neverthrow, oxide.ts) validate the approach

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all TypeScript built-ins
- Architecture: HIGH -- patterns directly derived from locked decisions and existing codebase structure
- Pitfalls: HIGH -- derived from actual code analysis (exact line numbers, exact import counts)
- Silent catch inventory: HIGH -- every catch block verified by reading source code

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable -- no external dependencies changing)
