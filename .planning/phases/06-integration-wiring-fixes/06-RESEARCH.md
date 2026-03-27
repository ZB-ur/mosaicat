# Phase 6: Integration Wiring Fixes - Research

**Researched:** 2026-03-27
**Domain:** TypeScript integration bug fixes / wiring existing modules
**Confidence:** HIGH

## Summary

Phase 6 is a gap closure phase -- four isolated bugs where modules built in Phases 2-5 are not correctly wired together. All four bugs have been root-caused with exact file/line references in the CONTEXT.md. No new libraries, no new patterns -- just connecting existing code at integration seams.

The fixes are independent of each other (no ordering dependency), each is small in scope (1-10 lines of production code), and each has an existing test file that either needs updating (fix-loop-runner) or a new test case added (shutdown-coordinator wiring, OutputGenerator, event-bus).

**Primary recommendation:** Fix all four bugs with corresponding test updates. Each bug is a single plan/task due to small scope. Verify with `npx vitest run` after each fix.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: `FixLoopRunner.checkTesterFailed()` at `fix-loop-runner.ts:106` reads `manifest?.quality_assessment?.verdict` but the Tester agent writes `verdict` at the top level of `test-report.manifest.json`
- D-02: Fix must read `manifest?.verdict` (not `quality_assessment?.verdict`)
- D-03: Update existing tests in `fix-loop-runner.test.ts` -- they currently use `{ quality_assessment: { verdict: 'fail' } }` which masks the bug
- D-04: Run-1774580045254 evidence: fix loop never triggered because verdict was never found
- D-05: `ShutdownCoordinator` exists but is never instantiated in `index.ts`
- D-06: Must instantiate ShutdownCoordinator in `index.ts` and pass its `signal` to `createRunContext()`
- D-07: `createRunContext()` already accepts optional `signal?: AbortSignal` -- just need to pass it
- D-08: `OutputGenerator` imports `getArtifactsDir` and `readArtifact` from legacy `../../core/artifact.js`
- D-09: Legacy `getArtifactsDir()` returns default `.mosaic/artifacts` (missing run ID) -- never scoped to run
- D-10: Caused deterministic ENOENT crash: writes to wrong directory
- D-11: Also caused `code.manifest.json` to have `"files": []`
- D-12: Fix: OutputGenerator constructor must accept `ArtifactIO` interface instead of importing legacy globals
- D-13: `stage:skipped` emitted in `stage-executor.ts:41` but not declared in `PipelineEvents` interface
- D-14: Add `'stage:skipped'` to `PipelineEvents` with matching signature

### Claude's Discretion
- Exact refactoring approach for OutputGenerator (constructor injection vs method parameter)
- Whether to add integration tests beyond fixing existing unit tests
- Order of fixes (all are independent)

### Deferred Ideas (OUT OF SCOPE)
- QA Lead prompt size optimization (127K tokens)
- Coder acceptance test pass rate analysis
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXEC-01 | Orchestrator uses while iteration + StageOutcome (gap: OutputGenerator uses legacy artifact API) | Bug 3 fix: OutputGenerator must accept ArtifactIO via constructor to use run-scoped paths |
| EXEC-02 | Tester-Coder fix loop extracted to FixLoopRunner (gap: wrong verdict path) | Bug 1 fix: change `quality_assessment?.verdict` to `verdict` at line 106 |
| EXEC-05 | ShutdownCoordinator for graceful SIGINT exit (gap: never instantiated) | Bug 2 fix: instantiate in index.ts, pass signal to createRunContext() |
</phase_requirements>

## Architecture Patterns

### Bug 1: FixLoopRunner Verdict Path (EXEC-02)

**What:** Single property path fix in `checkTesterFailed()`.

**Current code (fix-loop-runner.ts:106):**
```typescript
return manifest?.quality_assessment?.verdict === 'fail';
```

**Correct code (matching stage-executor.ts:202):**
```typescript
return manifest?.verdict === 'fail';
```

**Evidence chain (HIGH confidence):**
- `TestReportManifestSchema` at `manifest.ts:125` defines `verdict: z.enum(['pass', 'fail'])` at the top level
- `tester.ts:174-181` writes verdict at top level
- `stage-executor.ts:202` reads `manifest?.verdict` correctly (reference implementation)
- Tests in `fix-loop-runner.test.ts` ALL use `{ quality_assessment: { verdict: 'fail' } }` -- tests pass but mask the bug

**Test update scope:** Every `ctx.store.write('test-report.manifest.json', ...)` call in `fix-loop-runner.test.ts` must change from `{ quality_assessment: { verdict: '...' } }` to `{ verdict: '...' }`. There are 15 such occurrences across 10 test cases.

### Bug 2: ShutdownCoordinator Wiring (EXEC-05)

**What:** Instantiate `ShutdownCoordinator` in `index.ts` and pass its signal through the pipeline.

**Current state:**
- `ShutdownCoordinator` class fully implemented at `shutdown-coordinator.ts` with tests
- `createRunContext()` at `run-context.ts:46` accepts `signal?: AbortSignal`
- `index.ts` has no reference to ShutdownCoordinator

**Wiring approach:**
1. Import `ShutdownCoordinator` in `index.ts`
2. In the `run` and `resume` command blocks, create instance before orchestrator
3. Call `coordinator.install()` to register SIGINT/SIGTERM handlers
4. Pass `coordinator.signal` when constructing orchestrator or via a method

**Key question:** How does the signal reach `createRunContext()`? The Orchestrator creates RunContext internally. Two options:
- Option A: Orchestrator constructor accepts optional `AbortSignal` and forwards to `createRunContext()`
- Option B: Orchestrator.run() / Orchestrator.resumeRun() accepts signal parameter

Need to check Orchestrator constructor/run signatures.

### Bug 3: OutputGenerator Legacy Artifact API (EXEC-01)

**What:** Replace `getArtifactsDir()` and `readArtifact()` imports with `ArtifactIO` interface injection.

**Current OutputGenerator constructor:**
```typescript
constructor(
  private readonly stage: string,
  private readonly logger: { agent(...): void },
  private readonly writer: OutputWriter,
) {}
```

**Recommended new constructor (constructor injection, following CoderDeps pattern):**
```typescript
constructor(
  private readonly stage: string,
  private readonly logger: { agent(...): void },
  private readonly writer: OutputWriter,
  private readonly artifacts: ArtifactIO,
) {}
```

**Callers to update:** `coder.ts:219` -- already has `artifacts` (ArtifactIO) in scope from `createArtifactIO()` at line 61.

**Replacements inside OutputGenerator:**
| Old | New | Location |
|-----|-----|----------|
| `getArtifactsDir()` (line 24, 52) | `this.artifacts.getDir()` | generateManifest, generateReadme |
| `readArtifact('intent-brief.json')` (line 59) | `this.artifacts.read('intent-brief.json')` | generateReadme |
| `readArtifact('prd.manifest.json')` (line 78) | `this.artifacts.read('prd.manifest.json')` | generateReadme |
| `import { readArtifact, getArtifactsDir } from '../../core/artifact.js'` (line 2) | Remove entirely | Top of file |

**fs.writeFileSync call (line 155):** `fs.writeFileSync(\`${codeDir}/README.md\`, ...)` -- codeDir becomes `\`${this.artifacts.getDir()}/code\`` which returns the correct run-scoped path.

### Bug 4: PipelineEvents Missing stage:skipped

**What:** Add one event signature to the `PipelineEvents` interface.

**Current emit site (stage-executor.ts:41):**
```typescript
this.ctx.eventBus.emit('stage:skipped', stage, run.id);
```

**Current subscriber (cli-progress.ts:115):**
```typescript
on('stage:skipped', (stage, _runId) => { ... });
```

**Required addition to PipelineEvents in event-bus.ts:**
```typescript
'stage:skipped': (stage: StageName, runId: string) => void;
```

This is a one-line addition. Place it after `'stage:complete'` for logical grouping.

### Anti-Patterns to Avoid
- **Testing the wrong contract:** The fix-loop-runner tests tested against the wrong manifest shape and all passed. After fixing, confirm tests fail with the OLD code and pass with the NEW code.
- **Importing legacy globals in new code:** OutputGenerator is the last holdout using `getArtifactsDir()` / `readArtifact()`. After this fix, check there are no remaining imports of these functions from Phase 4/5 modules.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Artifact path scoping | Custom path resolution | `ArtifactIO.getDir()` | Already instance-scoped via ArtifactStore |
| Signal propagation | Custom cancellation | `AbortController` / `AbortSignal` | Native API, already used in ShutdownCoordinator |

## Common Pitfalls

### Pitfall 1: Test Data Masking Real Bugs
**What goes wrong:** Tests pass with incorrect manifest structure because both code and tests use the same wrong path.
**Why it happens:** Test was written against the implementation, not the schema contract.
**How to avoid:** After fixing `checkTesterFailed()`, verify old tests FAIL before updating them. Write a regression test that uses the actual `TestReportManifestSchema` structure.
**Warning signs:** Tests passing but production behavior broken.

### Pitfall 2: Orchestrator Signal Threading
**What goes wrong:** ShutdownCoordinator is instantiated but signal never reaches RunContext.
**Why it happens:** Orchestrator creates RunContext internally -- signal must be threaded through its API.
**How to avoid:** Check how Orchestrator creates RunContext and ensure signal parameter is plumbed through.
**Warning signs:** `coordinator.signal` never appears in Orchestrator constructor or run() method.

### Pitfall 3: OutputGenerator fs.writeFileSync with Wrong Path
**What goes wrong:** `fs.writeFileSync` at line 155 writes README to wrong directory even after replacing `getArtifactsDir()`.
**Why it happens:** `codeDir` is derived from `getArtifactsDir()` -- must update both `generateManifest()` (line 24) and `generateReadme()` (line 52) usages.
**How to avoid:** After refactoring, verify `codeDir` resolves to `.mosaic/artifacts/run-{id}/code` not `.mosaic/artifacts/code`.

### Pitfall 4: Forgetting to uninstall ShutdownCoordinator
**What goes wrong:** Signal handlers leak between test runs or pipeline completions.
**Why it happens:** `install()` registers process listeners -- must `uninstall()` on pipeline complete/error.
**How to avoid:** Use try/finally pattern in index.ts: install before run, uninstall in finally block.

## Code Examples

### Fix 1: FixLoopRunner.checkTesterFailed()
```typescript
// fix-loop-runner.ts:103-110
private checkTesterFailed(): boolean {
  try {
    const manifest = JSON.parse(this.ctx.store.read('test-report.manifest.json'));
    return manifest?.verdict === 'fail';  // was: manifest?.quality_assessment?.verdict
  } catch {
    return false;
  }
}
```

### Fix 2: ShutdownCoordinator in index.ts
```typescript
// index.ts -- in the 'run' command block
import { ShutdownCoordinator } from './core/shutdown-coordinator.js';

const coordinator = new ShutdownCoordinator();
coordinator.install();

try {
  // ... existing orchestrator setup ...
  const result = await orchestrator.run(instruction, autoApprove, profileArg);
  // ... existing result output ...
} finally {
  coordinator.uninstall();
  detach();
}
```

### Fix 3: OutputGenerator with ArtifactIO
```typescript
// output-generator.ts constructor
export class OutputGenerator {
  constructor(
    private readonly stage: string,
    private readonly logger: { agent(stage: string, level: string, event: string, data?: Record<string, unknown>): void },
    private readonly writer: OutputWriter,
    private readonly artifacts: ArtifactIO,
  ) {}

  generateManifest(plan: CodePlan): void {
    const codeDir = `${this.artifacts.getDir()}/code`;
    // ... rest unchanged
  }
}
```

### Fix 4: PipelineEvents addition
```typescript
// event-bus.ts -- add to PipelineEvents interface
'stage:skipped': (stage: StageName, runId: string) => void;
```

### Test Fix: fix-loop-runner.test.ts manifest structure
```typescript
// Before (wrong -- masks the bug):
ctx.store.write('test-report.manifest.json', JSON.stringify({
  quality_assessment: { verdict: 'fail' },
}));

// After (correct -- matches TestReportManifestSchema):
ctx.store.write('test-report.manifest.json', JSON.stringify({
  verdict: 'fail',
}));
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-02 | FixLoopRunner reads `manifest?.verdict` | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | Yes (needs update) |
| EXEC-05 | ShutdownCoordinator wired in index.ts | unit | `npx vitest run src/core/__tests__/shutdown-coordinator.test.ts -x` | Yes (unit tests exist, wiring test needed) |
| EXEC-01 | OutputGenerator uses ArtifactIO not legacy globals | unit | `npx vitest run src/agents/coder/__tests__/output-generator.test.ts -x` | Needs creation |
| N/A | PipelineEvents declares stage:skipped | compilation | `npx tsc --noEmit` | N/A (type-only) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose` (affected test file only)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + `npx tsc --noEmit` before verification

### Wave 0 Gaps
- [ ] `src/agents/coder/__tests__/output-generator.test.ts` -- covers EXEC-01 (OutputGenerator uses ArtifactIO)
- [ ] Update all 15 manifest structure occurrences in `src/core/__tests__/fix-loop-runner.test.ts` -- covers EXEC-02

## Open Questions

1. **How does AbortSignal reach createRunContext() from index.ts?**
   - What we know: Orchestrator creates RunContext internally. `createRunContext()` accepts optional `signal`.
   - What's unclear: Whether Orchestrator constructor or run() method already accepts a signal parameter, or if this needs to be added.
   - Recommendation: Read `orchestrator.ts` constructor and `run()` signature during planning. If no signal parameter exists, add one to the constructor (preferred -- signal is a run-level concern).

## Sources

### Primary (HIGH confidence)
- `src/core/manifest.ts:125` -- TestReportManifestSchema with top-level `verdict` field
- `src/core/stage-executor.ts:199-206` -- correct `checkTesterVerdict()` implementation
- `src/core/fix-loop-runner.ts:103-110` -- buggy `checkTesterFailed()` with wrong path
- `src/agents/coder/output-generator.ts` -- full source showing legacy imports
- `src/core/event-bus.ts` -- PipelineEvents interface missing `stage:skipped`
- `src/core/shutdown-coordinator.ts` -- complete implementation, never wired
- `src/core/run-context.ts:46-65` -- createRunContext with optional signal parameter
- `src/agents/coder.ts:46-68` -- ArtifactIO bridge pattern already in use

### Secondary (MEDIUM confidence)
- `.planning/debug/run-failure-analysis.md` -- root cause analysis of run-1774580045254

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all fixes use existing modules
- Architecture: HIGH -- all patterns already established in Phases 2-5
- Pitfalls: HIGH -- bugs are fully root-caused with exact line references

**Research date:** 2026-03-27
**Valid until:** Indefinite -- this is internal codebase analysis, not external dependency research
