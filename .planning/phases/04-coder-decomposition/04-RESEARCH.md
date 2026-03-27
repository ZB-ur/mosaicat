# Phase 4: Coder Decomposition - Research

**Researched:** 2026-03-27
**Domain:** TypeScript module decomposition / refactoring
**Confidence:** HIGH

## Summary

The CoderAgent in `src/agents/coder.ts` is a 1308-line monolith with clearly delineated sections (marked by comment dividers) that map directly to the 4 target sub-modules. The decomposition is a mechanical extraction -- no new libraries, no API changes, no external dependencies. The file already uses `// --- Section Name ---` dividers that align perfectly with the target split.

The key challenge is not the extraction itself but preserving the data flow between phases (planner output feeds skeleton, skeleton feeds implement, verify runs between modules, build runs after all modules, smoke test runs last). The facade must orchestrate this pipeline while each sub-module handles its own concerns.

**Primary recommendation:** Extract methods into 4 standalone classes in `src/agents/coder/` directory, each receiving `RunContext` + `LLMProvider` + `Logger` via constructor. The facade `coder.ts` stays at `src/agents/coder.ts` and delegates to sub-modules via composition.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion (infrastructure phase).

### Claude's Discretion
All implementation choices are at Claude's discretion -- pure infrastructure phase (code decomposition/refactoring). Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key areas requiring decisions:
- Sub-module interface design (CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner)
- How to split the existing 1312-line coder.ts without breaking existing behavior
- Facade delegation pattern (how coder.ts delegates to sub-modules)
- Test strategy for shell command execution paths in SmokeRunner

### Deferred Ideas (OUT OF SCOPE)
None -- infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CODER-01 | Extract `CoderPlanner` -- generates code-plan.json | Lines 386-425: `runPlanner()` + `extractArtifact()` are self-contained; only needs LLMProvider + ArtifactStore |
| CODER-02 | Extract `CoderBuilder` -- skeleton generation + module implementation | Lines 427-724: skeleton + implement methods share `buildImplementPrompt()` and file helpers |
| CODER-03 | Extract `BuildVerifier` -- compilation checks + build-fix loops | Lines 748-857, 1008-1079: shell commands + error extraction + build artifact analysis + acceptance tests (236-384) |
| CODER-04 | Extract `SmokeRunner` -- HTTP probes + smoke tests | Lines 866-1006: `runSmokeTest()` + `waitForPort()` are fully self-contained |
| CODER-05 | Rewrite `coder.ts` as thin facade (~200 lines) | The `run()` method (lines 72-234) is already a sequential pipeline -- replace method calls with sub-module delegations |
| TEST-04 | Shell command execution path tests (setup/build/verify/smoke-test) | BuildVerifier and SmokeRunner both use `execSync`/`spawn` -- test with mocked child_process or real temp directories |
</phase_requirements>

## Standard Stack

No new dependencies required. This is a pure refactoring phase using existing project infrastructure.

### Core (existing -- no changes)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.0 | Unit testing | Already project standard |
| zod | ^4.3.6 | Schema validation (CodePlanSchema) | Already used by code-plan-schema.ts |
| typescript | ^5.9.3 | Compilation | Already project standard |

### Supporting (existing -- no changes)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process | builtin | execSync/spawn for shell commands | BuildVerifier, SmokeRunner |
| node:net | builtin | TCP port checking | SmokeRunner.waitForPort() |
| node:fs | builtin | File I/O | All sub-modules |

**Installation:** None required -- all dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
src/agents/
  coder.ts              # Thin facade (< 250 lines), CoderAgent extends BaseAgent
  coder/
    coder-planner.ts    # CoderPlanner class
    coder-builder.ts    # CoderBuilder class
    build-verifier.ts   # BuildVerifier class
    smoke-runner.ts     # SmokeRunner class
    index.ts            # Re-exports all 4 sub-modules
  code-plan-schema.ts   # Unchanged (already separate)
```

### Pattern 1: Sub-Module as Plain Class (not BaseAgent subclass)

**What:** Each sub-module is a standalone class that receives dependencies via constructor, NOT a BaseAgent subclass. Only the facade (`CoderAgent`) extends `BaseAgent`.

**When to use:** Always for this decomposition -- sub-modules are internal implementation details, not pipeline stages.

**Why:** BaseAgent provides hook lifecycle, manifest writing, and stage identity. Sub-modules don't need any of these -- they're called by the facade which already has them.

**Example:**
```typescript
// src/agents/coder/coder-planner.ts
import type { LLMProvider } from '../../core/llm-provider.js';
import type { ArtifactStore } from '../../core/artifact-store.js';
import type { Logger } from '../../core/logger.js';
import type { EventBus } from '../../core/event-bus.js';
import type { StageName, AgentContext } from '../../core/types.js';
import { CodePlanSchema, type CodePlan } from '../code-plan-schema.js';

export class CoderPlanner {
  constructor(
    private readonly stage: StageName,
    private readonly provider: LLMProvider,
    private readonly store: ArtifactStore,
    private readonly logger: Logger,
    private readonly eventBus: EventBus,
  ) {}

  async createPlan(context: AgentContext): Promise<CodePlan> {
    // ... extracted from runPlanner()
  }

  loadExistingPlan(): CodePlan | null {
    // ... extracted from run() step 1 plan-reuse logic
  }
}
```

### Pattern 2: Facade Delegates to Composition

**What:** CoderAgent holds 4 sub-module instances, created in constructor or lazily in `run()`. The `run()` method becomes a thin orchestration of sub-module calls.

**Example:**
```typescript
// src/agents/coder.ts (facade, < 250 lines)
export class CoderAgent extends BaseAgent {
  private interactionHandler?: InteractionHandler;

  constructor(stage: StageName, ctx: RunContext, interactionHandler?: InteractionHandler) {
    super(stage, ctx);
    this.interactionHandler = interactionHandler;
  }

  getOutputSpec(): OutputSpec {
    return { artifacts: ['code/'], manifest: 'code.manifest.json' };
  }

  protected async run(context: AgentContext): Promise<void> {
    const planner = new CoderPlanner(this.stage, this.provider, this.ctx.store, this.logger, this.ctx.eventBus);
    const builder = new CoderBuilder(this.stage, this.provider, this.ctx.store, this.logger, this.ctx.eventBus);
    const verifier = new BuildVerifier(this.stage, this.provider, this.ctx.store, this.logger, this.ctx.eventBus);
    const smoker = new SmokeRunner(this.stage, this.ctx.store, this.logger, this.ctx.eventBus);

    // Step 1: Plan
    const plan = planner.loadExistingPlan() ?? await planner.createPlan(context);

    // Step 2-5: Build
    await builder.runSkeleton(context, plan);
    verifier.runSetup(plan);
    // ... etc
  }
}
```

### Pattern 3: Dependency Struct Instead of Many Constructor Args

**What:** If a sub-module needs 4+ dependencies, bundle them into a typed struct to reduce constructor noise.

**Example:**
```typescript
export interface CoderDeps {
  readonly stage: StageName;
  readonly provider: LLMProvider;
  readonly store: ArtifactStore;
  readonly logger: Logger;
  readonly eventBus: EventBus;
}

export class CoderPlanner {
  constructor(private readonly deps: CoderDeps) {}
}
```

**Recommendation:** Use this pattern. All 4 sub-modules need the same 5 dependencies (except SmokeRunner which doesn't need LLMProvider). A shared `CoderDeps` interface avoids 5-arg constructors repeated 4 times.

### Anti-Patterns to Avoid
- **Sub-modules extending BaseAgent:** They're not pipeline stages, they're internal helpers. BaseAgent adds hook lifecycle overhead and requires StageName identity.
- **Passing RunContext directly to sub-modules:** RunContext bundles AbortSignal, config, devMode which sub-modules don't need. Extract only what they use.
- **Moving code-plan-schema.ts into coder/:** It's already separate and imported by other modules. Leave it where it is.
- **Changing the public API:** `createAgent()` in agent-factory.ts creates `CoderAgent`. The constructor signature must stay compatible: `(stage, ctx, interactionHandler?)`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test mocking for child_process | Custom process mock | `vi.mock('node:child_process')` + vitest spy | Standard vitest mocking, already used in project |
| Temporary directories for tests | Manual mkdirSync/rmSync | `fs.mkdtempSync(os.tmpdir())` + afterEach cleanup | OS-managed temp dirs avoid test pollution |
| Port availability checking | Custom TCP probe | Reuse existing `waitForPort()` as-is in SmokeRunner | Already battle-tested in production |

**Key insight:** This is a refactoring phase -- the existing code is correct. The goal is to split it, not rewrite it. Preserve all existing behavior including edge cases.

## Common Pitfalls

### Pitfall 1: Breaking the retry/resume contract
**What goes wrong:** CoderAgent has careful resume logic -- `isSkeletonComplete()` checks if files exist to skip re-generation, `loadExistingPlan()` reuses code-plan.json. If sub-modules don't preserve these checks, retries/resumes break.
**Why it happens:** Extraction focuses on the happy path and misses the retry branches.
**How to avoid:** Each sub-module must handle its own "already done" detection. CoderPlanner: check store.exists('code-plan.json'). CoderBuilder: check isSkeletonComplete(). BuildVerifier: no skip logic needed. SmokeRunner: no skip logic needed.
**Warning signs:** Tests pass on first run but fail on retry scenarios.

### Pitfall 2: Losing the InteractionHandler for user confirmation
**What goes wrong:** `askUserToRetry()` (line 728-746) uses `this.interactionHandler` which is specific to CoderAgent. If moved to BuildVerifier, it needs to receive InteractionHandler as a dependency.
**Why it happens:** InteractionHandler is optional and only used in the build-fix loop when AUTO_FIX_RETRIES is exceeded.
**How to avoid:** BuildVerifier receives an optional `InteractionHandler` in its deps or via a callback. The facade provides it from its own field.
**Warning signs:** Build fix loops never prompt the user and silently give up after AUTO_FIX_RETRIES.

### Pitfall 3: File helper duplication
**What goes wrong:** `listBuiltFiles()`, `walkDir()`, `extractErrorFiles()` are used by multiple phases (builder, verifier, manifest). Duplicating them in each sub-module bloats code.
**Why it happens:** Helpers are private methods on CoderAgent, shared across responsibilities.
**How to avoid:** Extract shared helpers to a `coder/utils.ts` module or keep them in the sub-module that owns them (BuildVerifier for extractErrorFiles, a shared utils for listBuiltFiles/walkDir).
**Warning signs:** Same function copied into 3 files.

### Pitfall 4: Constants scattered across sub-modules
**What goes wrong:** The 12+ constants at the top of coder.ts (PLANNER_BUDGET_USD, SKELETON_TIMEOUT_MS, etc.) each belong to a specific sub-module. Putting them all in a shared constants file creates unnecessary coupling.
**Why it happens:** Premature centralization.
**How to avoid:** Each sub-module owns its constants. PLANNER_BUDGET_USD goes to coder-planner.ts, SKELETON_TIMEOUT_MS/SKELETON_BUDGET_USD go to coder-builder.ts, AUTO_FIX_RETRIES goes to build-verifier.ts, SMOKE_TEST_TIMEOUT_MS goes to smoke-runner.ts. Shared constants (PLACEHOLDER_KEYWORDS, MIN_BUNDLE_SIZE_BYTES, MIN_HTML_LENGTH) can go to a shared utils or to the sub-module that uses them.
**Warning signs:** A constants.ts file that every sub-module imports.

### Pitfall 5: Acceptance tests belong to BuildVerifier, not a separate module
**What goes wrong:** The acceptance test methods (lines 236-384) are a significant block of code. Tempting to create a 5th sub-module for them.
**Why it happens:** Acceptance tests look like a separate concern.
**How to avoid:** Acceptance tests are part of the verification flow -- they run `execSync`, parse test output, and trigger fix cycles. They belong in BuildVerifier alongside compilation checks and build-fix loops. Both share `fixAcceptanceFailures()` which uses the LLM provider in the same pattern as `runBuildFix()`.
**Warning signs:** A 5th sub-module that nobody asked for.

## Code Examples

### Decomposition Map (exact line ranges from current coder.ts)

```
CoderPlanner (CODER-01):
  - runPlanner()           lines 388-425  (~37 lines)
  - extractArtifact()      lines 1107-1117 (~11 lines)
  Total: ~50 lines + class boilerplate

CoderBuilder (CODER-02):
  - runSkeleton()          lines 429-481  (~53 lines)
  - isSkeletonComplete()   lines 486-491  (~6 lines)
  - runSkeletonFix()       lines 496-543  (~48 lines)
  - implementModule()      lines 547-575  (~29 lines)
  - implementModuleWithErrors() lines 577-637 (~61 lines)
  - buildImplementPrompt() lines 639-691  (~53 lines)
  - getModulesToImplement() lines 699-724 (~26 lines)
  Total: ~276 lines + class boilerplate

BuildVerifier (CODER-03):
  - runSetupCommand()      lines 1010-1024 (~15 lines)
  - runVerifyCommand()     lines 1026-1041 (~16 lines)
  - runBuildCommand()      lines 1043-1058 (~16 lines)
  - runBuildFix()          lines 750-786   (~37 lines)
  - analyzeBuildArtifacts() lines 794-852  (~59 lines)
  - logAnalysisResult()    lines 854-864   (~11 lines)
  - extractErrorFiles()    lines 1065-1079 (~15 lines)
  - runAcceptanceTests()   lines 242-320   (~79 lines)
  - executeAcceptanceTests() lines 322-350 (~29 lines)
  - fixAcceptanceFailures() lines 352-384  (~33 lines)
  - askUserToRetry()       lines 728-746   (~19 lines)
  Total: ~329 lines + class boilerplate

SmokeRunner (CODER-04):
  - runSmokeTest()         lines 872-949   (~78 lines)
  - waitForPort()          lines 955-1006  (~52 lines)
  Total: ~130 lines + class boilerplate

Shared Helpers (utils.ts):
  - listBuiltFiles()       lines 1083-1091 (~9 lines)
  - walkDir()              lines 1093-1103 (~11 lines)
  Total: ~20 lines

Manifest/README (stays in facade or moves to builder):
  - generateManifest()     lines 1121-1147 (~27 lines)
  - generateReadme()       lines 1151-1261 (~111 lines)
  - escapeForMermaid()     lines 1263-1268 (~6 lines)
  - buildDirectoryTree()   lines 1270-1307 (~38 lines)
  Total: ~182 lines

Facade (CODER-05):
  - constructor            lines 56-63    (~8 lines)
  - getOutputSpec()        lines 65-70    (~6 lines)
  - run()                  lines 72-234   (~163 lines -> reduced to ~80-100 with delegation)
  - generateManifest()     ~27 lines (if kept in facade)
  - generateReadme()       ~111 lines (if kept in facade)
  Total: ~200-250 lines
```

### Sub-Module Dependency Table

| Sub-Module | LLMProvider | ArtifactStore | Logger | EventBus | InteractionHandler | child_process | node:net |
|------------|-------------|---------------|--------|----------|--------------------|---------------|----------|
| CoderPlanner | yes | yes | yes | yes | no | no | no |
| CoderBuilder | yes | yes | yes | yes | no | no | no |
| BuildVerifier | yes | yes | yes | yes | optional | yes (execSync) | no |
| SmokeRunner | no | yes | yes | yes | no | yes (spawn) | yes |

### Interface Design for CoderDeps

```typescript
// src/agents/coder/types.ts
import type { StageName } from '../../core/types.js';
import type { LLMProvider } from '../../core/llm-provider.js';
import type { ArtifactStore } from '../../core/artifact-store.js';
import type { Logger } from '../../core/logger.js';
import type { EventBus } from '../../core/event-bus.js';
import type { InteractionHandler } from '../../core/interaction-handler.js';

export interface CoderDeps {
  readonly stage: StageName;
  readonly provider: LLMProvider;
  readonly store: ArtifactStore;
  readonly logger: Logger;
  readonly eventBus: EventBus;
}

export interface BuildVerifierDeps extends CoderDeps {
  readonly interactionHandler?: InteractionHandler;
}

export interface SmokeRunnerDeps {
  readonly stage: StageName;
  readonly store: ArtifactStore;
  readonly logger: Logger;
  readonly eventBus: EventBus;
}
```

### Prompt Path Constants

The 3 prompt file paths are used by specific sub-modules:
- `PLANNER_PROMPT_PATH` -> CoderPlanner
- `BUILDER_PROMPT_PATH` -> CoderBuilder (also used by BuildVerifier for fix prompts)
- `SKELETON_PROMPT_PATH` -> CoderBuilder

Since BuildVerifier shares `BUILDER_PROMPT_PATH` with CoderBuilder, either:
1. Both import it from a shared constants location, or
2. BuildVerifier receives it as a constructor option with a default

Recommendation: Keep prompt paths as module-level constants in the sub-module that primarily owns them. BuildVerifier can import `BUILDER_PROMPT_PATH` from coder-builder.ts or define its own copy.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/agents/__tests__/coder --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CODER-01 | CoderPlanner generates code-plan.json from LLM response | unit | `npx vitest run src/agents/__tests__/coder-planner.test.ts -x` | Wave 0 |
| CODER-02 | CoderBuilder handles skeleton + module implementation | unit | `npx vitest run src/agents/__tests__/coder-builder.test.ts -x` | Wave 0 |
| CODER-03 | BuildVerifier runs compilation checks and fix loops | unit | `npx vitest run src/agents/__tests__/build-verifier.test.ts -x` | Wave 0 |
| CODER-04 | SmokeRunner performs HTTP probes with shell execution | unit | `npx vitest run src/agents/__tests__/smoke-runner.test.ts -x` | Wave 0 |
| CODER-05 | coder.ts facade is under 250 lines and delegates correctly | unit | `npx vitest run src/agents/__tests__/coder-facade.test.ts -x` | Wave 0 |
| TEST-04 | Shell command execution paths tested (setup/build/verify/smoke) | unit | `npx vitest run src/agents/__tests__/build-verifier.test.ts src/agents/__tests__/smoke-runner.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/agents/__tests__/coder --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/agents/__tests__/coder-planner.test.ts` -- covers CODER-01
- [ ] `src/agents/__tests__/coder-builder.test.ts` -- covers CODER-02
- [ ] `src/agents/__tests__/build-verifier.test.ts` -- covers CODER-03, TEST-04
- [ ] `src/agents/__tests__/smoke-runner.test.ts` -- covers CODER-04, TEST-04
- [ ] `src/agents/__tests__/coder-facade.test.ts` -- covers CODER-05

### TEST-04 Strategy: Shell Command Execution Path Tests

TEST-04 requires testing the 4 shell command paths: setup, build, verify, smoke-test. Strategy:

1. **BuildVerifier tests (setup/build/verify):** Use `vi.mock('node:child_process')` to mock `execSync`. Test:
   - `runSetupCommand()`: successful execution, failure logging
   - `runVerifyCommand()`: success returns `{success: true}`, failure returns error string parsed from stdout/stderr
   - `runBuildCommand()`: same pattern as verify
   - Error extraction: `extractErrorFiles()` correctly parses tsc and bundler error formats

2. **SmokeRunner tests (smoke-test):** Use `vi.mock('node:child_process')` to mock `spawn` and `vi.mock('node:net')` to mock `net.Socket`. Test:
   - `runSmokeTest()`: skips when no smokeTest config, skips for non-web types
   - `waitForPort()`: resolves true when port connects, resolves false on timeout, resolves true on readyPattern match
   - Process cleanup: proc.pid kill in finally block

3. **Integration-style tests (optional):** Use a real temp directory with a minimal package.json + tsconfig.json, run actual `npm install` and `tsc`. Only if unit tests don't cover enough.

## Open Questions

1. **Where do generateManifest() and generateReadme() live?**
   - What we know: They're called at the end of `run()`, produce final output artifacts. They use `listBuiltFiles()` and plan data.
   - What's unclear: They don't fit cleanly into any of the 4 sub-modules. They're more "output formatting" than planning/building/verifying/testing.
   - Recommendation: Keep them in the facade. They're ~180 lines total but are simple data formatting with no LLM calls. The facade will be ~200-250 lines including these, which meets the < 250 line target. If it exceeds 250, extract to a `coder/output-generator.ts`.

2. **Should Prompt paths be configurable or hardcoded?**
   - What we know: Currently hardcoded as module-level constants. Config files in `config/agents.yaml` specify prompt paths but CoderAgent reads them directly.
   - What's unclear: Whether future phases will need to change prompt paths.
   - Recommendation: Keep hardcoded for now. The decomposition phase should not change behavior, only structure.

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of `src/agents/coder.ts` (1308 lines)
- Direct source code analysis of `src/core/agent.ts` (BaseAgent contract)
- Direct source code analysis of `src/core/run-context.ts` (RunContext interface)
- Direct source code analysis of `src/core/agent-factory.ts` (CoderAgent instantiation)
- Direct source code analysis of `src/core/llm-provider.ts` (LLMProvider interface)
- Direct source code analysis of `src/agents/code-plan-schema.ts` (CodePlan types)
- Direct source code analysis of `src/core/retry-log.ts` (logRetry/classifyError)
- Direct source code analysis of existing test patterns in `src/agents/__tests__/`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure refactoring
- Architecture: HIGH - decomposition boundaries are clearly marked in source code with comment dividers
- Pitfalls: HIGH - identified from direct code analysis of retry/resume paths, InteractionHandler, and shared helpers

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable -- refactoring of existing code, no external API changes)
