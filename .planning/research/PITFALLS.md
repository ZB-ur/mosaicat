# Domain Pitfalls: Partial Codebase Rewrite

**Domain:** TypeScript multi-agent pipeline system -- partial rewrite (~70% rewrite, ~30% preserved)
**Researched:** 2026-03-26
**Overall Confidence:** HIGH (based on codebase analysis + established rewrite patterns)

---

## Critical Pitfalls

Mistakes that cause rewrites of the rewrite, or multi-day debugging sessions.

### Pitfall 1: Phantom Interface Drift

**What goes wrong:** The preserved interface files (`types.ts`, `llm-provider.ts`, `interaction-handler.ts`, `adapters/types.ts`) define the contracts. During rewrite, a developer changes the *runtime behavior* of a rewritten module (return shape, error semantics, timing) while keeping the TypeScript type signature identical. The compiler sees no error, but the preserved modules that depend on the old behavior break at runtime.

**Why it happens:** TypeScript types are erased at runtime. A function that returns `Promise<string>` can return an empty string, a JSON string, or throw -- all type-correct. When you rewrite the orchestrator's `executeStage` from recursive to iterative, the return value types match, but the error propagation path changes. Preserved modules like `git-publisher.ts` or `github-interaction-handler.ts` that catch specific error types or rely on specific timing will silently break.

**Consequences:** Tests pass (they mock the rewritten module). Integration breaks in production. Debugging is hard because the type system says everything is fine.

**Prevention:**
1. Before rewriting any module, write a **behavioral contract test** that exercises the module from the perspective of its consumers. This test uses the real (preserved) consumer code, not mocks.
2. Specifically document the *runtime contract* beyond types: "executeStage throws ClarificationNeeded on clarification, re-throws agent errors after logging, always writes pipeline-state.json before returning."
3. Run the existing E2E tests (`e2e-phase3/4/5.test.ts`) after every module rewrite -- they exercise the preserved + rewritten modules together.

**Detection:** Integration test failures that unit tests miss. Preserved module behavior changes without any code changes to preserved files. Error messages appearing in different log locations.

**Phase relevance:** Every phase. The very first rewritten module sets the pattern.

---

### Pitfall 2: Singleton State Contamination During Transition

**What goes wrong:** The codebase has two singletons with mutable state: `eventBus` (module-level singleton in `event-bus.ts`) and `artifact.ts` (module-level `currentRunDir`/`baseDir`). The rewrite plan includes replacing `artifact.ts` global state with `ArtifactStore` instances. During the transition period where *some* code uses the new `ArtifactStore` and *some* preserved code still calls `readArtifact()`/`writeArtifact()` (which use the global), the two systems point to different directories or have inconsistent state.

**Why it happens:** You cannot atomically switch all callers. The `BaseAgent.execute()` method (preserved) calls `writeArtifact()` (global). A rewritten orchestrator might initialize `ArtifactStore` but the agent base class still writes to the old global. During the transition, artifacts end up in two different locations.

**Consequences:** Agents write artifacts to one location; downstream agents read from another. Pipeline completes but with missing or stale artifacts. Resume from `pipeline-state.json` points to the wrong directory.

**Prevention:**
1. **Bridge pattern:** Make `ArtifactStore` the single source of truth internally, but have its constructor also call `initArtifactsDir()` to keep the global in sync. The global functions become thin wrappers around the store instance. This way, preserved code calling `readArtifact()` goes through the same store.
2. **Never have two parallel artifact systems.** The store must wrap the global, not replace it. Remove the global only after all callers are migrated.
3. Write a test that creates an `ArtifactStore`, writes via the store, then reads via the global `readArtifact()` -- and vice versa. They must see the same data.

**Detection:** `readArtifact()` returns empty/undefined when you know the artifact was written. Test isolation failures (tests leak state to each other). `fileParallelism: false` in vitest config is a symptom of this class of problem -- it already exists.

**Phase relevance:** The phase that rewrites `artifact.ts` and orchestrator. Must be handled as the first or second rewrite target, because everything depends on it.

---

### Pitfall 3: Test Suite Becomes a Lie

**What goes wrong:** The existing test suite uses `as any` casts (6 files documented in CONCERNS.md), inline mock providers that return hardcoded responses, and `vi.mock()` to replace entire modules. When you rewrite a module, the tests that mock it continue to pass because they never exercise the real rewritten code. Meanwhile, the tests for the rewritten module pass because they mock the preserved modules. Nobody tests the real integration.

**Why it happens:** Mock-heavy test suites create a parallel universe. Each test file defines its own `MockLLMProvider` with hardcoded responses routed by system prompt content. When you change how prompts are assembled (rewriting `prompt-assembler.ts` or `context-manager.ts`), the mock routing breaks silently -- the mock just returns a default response instead of the stage-specific one.

**Consequences:** 100% test pass rate with a broken system. False confidence leads to skipping manual verification. Regressions discovered only during actual pipeline runs.

**Prevention:**
1. **Integration tests are the source of truth during a rewrite, not unit tests.** Run `e2e-phase3/4/5.test.ts` and `orchestrator-integration.test.ts` after every module change. If they break, fix them before proceeding.
2. **Kill the `as any` casts early.** Create typed mock factories (`createMockProvider(): LLMProvider`, `createMockLogger(): Logger`) in `test-helpers.ts` and replace all `as any` casts. This ensures test constructors match real constructors.
3. **Add a "canary" integration test** that runs the full pipeline with mock LLM but real everything else (real agents, real artifact I/O, real context assembly, real manifest validation). If this test passes, the system works.
4. After rewriting a module, verify that removing the `vi.mock()` for that module in integration tests still passes. If the integration test requires mocking the module you just rewrote, the test is not testing reality.

**Detection:** Tests pass but `mosaicat run` fails. Test coverage numbers are high but concentrated in unit tests. Integration tests have not been updated since the rewrite started.

**Phase relevance:** Must be addressed in the first phase (test infrastructure hardening) before any rewrite work begins.

---

### Pitfall 4: Rewriting the Orchestrator While It Orchestrates Everything

**What goes wrong:** The orchestrator (`orchestrator.ts`, 1057 lines) is the hub that connects all other modules. It calls the agent factory, context manager, event bus, artifact layer, interaction handler, evolution engine, git publisher, and pipeline state machine. Rewriting it while all those modules exist in various states of rewritten/preserved creates a combinatorial explosion of integration points to verify.

**Why it happens:** The orchestrator has the most dependencies of any module in the system (see the dependency graph in ARCHITECTURE.md). Every other rewrite target (artifact store, coder agent, evolution engine, context manager) changes something the orchestrator depends on. If you rewrite the orchestrator first, you build against old interfaces. If you rewrite it last, you must adapt it to every intermediate change.

**Consequences:** The orchestrator rewrite takes 3x longer than estimated because every other module change requires re-verifying orchestrator behavior. Or the orchestrator is rewritten first and must be patched repeatedly as other modules change.

**Prevention:**
1. **Rewrite the orchestrator last, or split it into two phases.** First phase: extract the fix loop, retry logic, and recursive `executeStage` into an iterative loop (surgical change, behavior-preserving). Second phase: adapt to new `ArtifactStore`, new coder sub-modules, etc.
2. **Alternatively, rewrite leaf modules first (evolution engine, validator, coder sub-modules), then mid-tier (context manager, artifact store), then orchestrator.** This is the strangler fig approach -- each layer is stable before the next one changes.
3. Keep the orchestrator integration test (`orchestrator-integration.test.ts`) green at all times. It is the canary for the whole system.

**Detection:** Orchestrator changes touching 5+ other modules in a single PR. Orchestrator test requiring constant mock updates. Multiple "fix orchestrator after X rewrite" commits.

**Phase relevance:** Phase ordering decision. The orchestrator rewrite phase must come after leaf and mid-tier module rewrites.

---

## Moderate Pitfalls

### Pitfall 5: Import Extension Breakage (.js in ESM)

**What goes wrong:** The codebase uses NodeNext module resolution, requiring `.js` extensions on all relative imports (`import { foo } from './bar.js'`). When splitting a module (e.g., `coder.ts` into `coder-planner.ts`, `coder-builder.ts`, etc.), every file that imported from the original must be updated. Missing a single `.js` extension causes a runtime `ERR_MODULE_NOT_FOUND` that TypeScript does not catch at compile time.

**Why it happens:** TypeScript checks types, not runtime module resolution correctness for `.js` extensions in NodeNext mode. If you rename `coder.ts` to `coder/index.ts` and re-export, existing `import from './coder.js'` may or may not resolve depending on your exact Node.js version and file structure.

**Prevention:**
1. After any file rename or split, run `npm run build && node dist/index.js --help` to verify runtime resolution.
2. Use `tsc --noEmit` as a pre-commit check, but also run the actual compiled output.
3. When splitting `coder.ts`, keep a `coder.ts` barrel file that re-exports from the sub-modules. This preserves all existing import paths.

**Detection:** `tsc` passes but `node dist/...` fails with module not found. Tests pass (vitest handles resolution differently than Node.js runtime).

**Phase relevance:** The coder split phase and any module reorganization phase.

---

### Pitfall 6: Zod v4 Schema Incompatibility

**What goes wrong:** The project uses Zod v4 (^4.3.6), which has breaking changes from v3. During the rewrite, if you copy-paste schema patterns from v3 documentation, StackOverflow answers, or AI suggestions trained on v3, the schemas compile but validate incorrectly (different coercion rules, different error formats).

**Why it happens:** Zod v4 changed `.parse()` error format, removed `.passthrough()` default behavior, and changed how `.transform()` interacts with `.default()`. Most online resources and AI training data still reference v3 patterns. The manifest schemas in `manifest.ts` are critical -- incorrect validation means corrupt manifests pass validation and reach the Validator agent.

**Prevention:**
1. When writing new Zod schemas, verify against the Zod v4 documentation specifically.
2. Write explicit test cases for each schema with both valid and intentionally invalid data.
3. Never copy Zod patterns from external sources without verifying the version.

**Detection:** Manifests that should fail validation pass silently. Validator agent reports "PASS" on malformed data. Schema `parse()` errors have unexpected format.

**Phase relevance:** Any phase that adds or modifies Zod schemas (manifest changes, new sub-module schemas for coder split).

---

### Pitfall 7: Silent Error Swallowing Migrates to New Code

**What goes wrong:** The codebase has 9 silent catches in evolution engine and 7 in validator (documented in CONCERNS.md). During rewrite, the developer copies the pattern or "preserves behavior" by keeping the silent catches. The rewrite was supposed to fix this, but the pattern is contagious -- new code inherits the anti-pattern from adjacent preserved code.

**Why it happens:** When rewriting a module, the developer reads the existing code for behavior reference. They see `catch {}` and think "this must be intentional" or "I'll fix it later." Later never comes because the tests pass (the silent catch makes error paths invisible to tests).

**Prevention:**
1. **Error handling policy must be defined before the rewrite starts:** Every catch block must either (a) log at warn/error level, (b) return an explicit error state, or (c) re-throw. No empty catches.
2. Add a lint rule or grep check: `grep -rn 'catch\s*{' src/ | grep -v 'catch (e' | grep -v 'catch (err'` should return zero results after each phase.
3. For each rewritten module, explicitly list the error scenarios in the PR description and how they are handled.

**Detection:** `grep -rn 'catch\s*(\w*)\s*{\s*}' src/` finds empty catch blocks. New code has `catch (e) { /* TODO */ }` comments.

**Phase relevance:** Every phase. Enforce in code review for every PR.

---

### Pitfall 8: Config Mutation Leaks Across Stages

**What goes wrong:** The orchestrator mutates `this.agentsConfig.agents['coder'].inputs` during the tester-coder fix loop (documented in CONCERNS.md). The rewrite plans to fix this with clone-before-mutate. But the same pattern may exist in other places not yet identified, or the rewrite introduces new mutations on shared config objects.

**Why it happens:** JavaScript objects are passed by reference. When you write `const config = this.agentsConfig.agents[stage]`, you get a reference, not a copy. Mutations on `config` affect the shared state. TypeScript's type system does not prevent mutation of non-`readonly` properties.

**Prevention:**
1. Make all config types use `Readonly<>` or `ReadonlyDeep<>` wrapper types. This makes accidental mutation a compile-time error.
2. In the orchestrator, deep-clone config at the start of each stage: `const stageConfig = structuredClone(this.agentsConfig.agents[stage])`.
3. Add a test that runs two stages sequentially and verifies the config object is unchanged after the first stage completes.

**Detection:** A stage receives config that contains data from a previous stage's execution. The `test_failures` input appears in the coder config even on fresh runs.

**Phase relevance:** The orchestrator rewrite phase specifically.

---

### Pitfall 9: Breaking the Resume Contract

**What goes wrong:** The resume flow depends on `pipeline-state.json` being an accurate representation of completed stages and their artifacts existing on disk. When you rewrite the artifact layer (global to `ArtifactStore`) or change how the orchestrator writes state, old `pipeline-state.json` files from v1 runs become incompatible with v2 resume logic. Users who interrupt a v1 run and try to resume after upgrading to v2 get corrupt state.

**Why it happens:** Resume is an implicit serialization contract. The state file format, artifact directory structure, and stage completion semantics are all part of this contract. None of these are documented -- they are emergent from the code.

**Prevention:**
1. **Document the resume contract explicitly** before rewriting: state file schema, expected artifact paths per stage, stage status meanings.
2. Add a version field to `pipeline-state.json`. On resume, check the version and either migrate or fail with a clear message.
3. Write the resume integration tests (identified as a gap in CONCERNS.md) *before* rewriting the artifact layer. These tests become the regression safety net.

**Detection:** `mosaicat resume` fails with cryptic errors after upgrading. Artifacts from completed stages are re-run unnecessarily. Stage marked "done" but artifacts missing.

**Phase relevance:** Must be addressed before the artifact layer rewrite. The resume integration tests are a prerequisite.

---

## Minor Pitfalls

### Pitfall 10: Event Bus Subscriber Drift

**What goes wrong:** The `eventBus` singleton emits typed events. When you change event emission points in the orchestrator (e.g., `stage:start` now fires at a different point in the iterative loop vs the recursive call), subscribers like `cli-progress.ts` receive events in a different order or at different times, causing garbled terminal output.

**Prevention:** Write a test that captures the sequence of events emitted during a full pipeline run. After rewrite, verify the sequence is unchanged or intentionally changed with corresponding subscriber updates.

**Phase relevance:** Orchestrator rewrite phase.

---

### Pitfall 11: Barrel File Re-export Ordering

**What goes wrong:** `src/agents/index.ts` re-exports all agent classes. When adding new sub-modules from the coder split (e.g., `CoderPlanner`, `CoderBuilder`), circular dependency issues can arise if the new modules import from the barrel while the barrel imports from them.

**Prevention:** New sub-modules should import from specific files, never from the barrel `index.ts`. The barrel is for external consumers only.

**Phase relevance:** Coder split phase.

---

### Pitfall 12: Vitest Module Mock Staleness

**What goes wrong:** Vitest's `vi.mock()` hoists to the top of the file and replaces modules before any imports. When you rename or move a module during rewrite (e.g., `../provider-factory.js` becomes `../providers/factory.js`), the `vi.mock()` path in test files silently stops matching -- the mock is never applied, and the test runs against the real module. This can cause tests to unexpectedly pass or fail for the wrong reasons.

**Prevention:** After any module path change, search all test files for `vi.mock` calls referencing the old path. Use `grep -rn "vi.mock.*old-module-name" src/` as a post-rename check.

**Phase relevance:** Any phase involving file moves or renames.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Test infrastructure hardening | Pitfall 3 (test suite becomes a lie) | Fix `as any` casts, create typed mock factories, add canary integration test BEFORE any rewrites |
| Artifact layer rewrite (global to ArtifactStore) | Pitfall 2 (singleton state contamination) | Bridge pattern: ArtifactStore wraps the global, never runs parallel |
| Artifact layer rewrite | Pitfall 9 (resume contract breakage) | Write resume integration tests first, add version to state file |
| Coder agent split (1312 lines to 4 modules) | Pitfall 5 (import extension breakage) | Keep `coder.ts` as barrel re-export, verify runtime resolution |
| Coder agent split | Pitfall 11 (circular barrel imports) | Sub-modules import specific files, never the barrel |
| Evolution engine error handling | Pitfall 7 (silent catch migration) | Enforce error handling policy, grep for empty catches |
| Orchestrator rewrite (recursive to iterative) | Pitfall 1 (phantom interface drift) | Behavioral contract tests before rewrite, E2E tests after |
| Orchestrator rewrite | Pitfall 4 (rewriting the hub) | Do it last or in two surgical phases |
| Orchestrator rewrite | Pitfall 8 (config mutation leaks) | `Readonly<>` types + `structuredClone()` at stage boundaries |
| Orchestrator rewrite | Pitfall 10 (event bus subscriber drift) | Event sequence snapshot test |
| Any module rename/move | Pitfall 12 (vi.mock staleness) | Grep for old paths in test files post-rename |
| Any schema work | Pitfall 6 (Zod v4 incompatibility) | Verify against v4 docs, test with invalid data |

---

## Sources

- Codebase analysis: `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md`
- Project context: `.planning/PROJECT.md`
- [Strangler Fig Pattern - Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [Strangler Fig Pattern - Martin Fowler](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Refactor or Rewrite? - DEV Community](https://dev.to/kodus/refactor-or-rewrite-dealing-with-code-thats-grown-too-large-2cm)
- [Good Refactoring vs Bad Refactoring - Builder.io](https://www.builder.io/blog/good-vs-bad-refactoring)
- [Singleton Anti-Pattern - Medium](https://medium.com/@gedeon.dominguez/the-singleton-anti-pattern-3c8a46499f0d)
- [Don't use Singleton in unit tests - DEV Community](https://dev.to/bacarpereira/don-t-use-singleton-pattern-in-your-unit-tests-8p7)
- [TypeScript Performance in Large-Scale Projects - Mindful Chase](https://www.mindfulchase.com/explore/troubleshooting-tips/programming-languages/troubleshooting-typescript-performance-and-type-safety-issues-in-large-scale-projects.html)

---

*Pitfalls analysis: 2026-03-26*
