# Phase 6: Integration Wiring Fixes - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** Debug analysis of run-1774580045254 + code inspection

<domain>
## Phase Boundary

Wire together all Phase 2-5 modules that were built in isolation. Fix the integration seams: fix loop verdict path, ShutdownCoordinator instantiation, OutputGenerator artifact scoping, and PipelineEvents type completeness. This is a gap closure phase — no new features, only connecting existing code correctly.

</domain>

<decisions>
## Implementation Decisions

### Bug 1: FixLoopRunner verdict path (EXEC-02)
- **D-01:** `FixLoopRunner.checkTesterFailed()` at `fix-loop-runner.ts:106` reads `manifest?.quality_assessment?.verdict` but the Tester agent writes `verdict` at the top level of `test-report.manifest.json` (confirmed in `tester.ts:180` and `TestReportManifestSchema` at `manifest.ts:125`)
- **D-02:** Fix must read `manifest?.verdict` (not `quality_assessment?.verdict`) — this matches `StageExecutor.checkTesterFailed()` at `stage-executor.ts:202` which already reads the correct path
- **D-03:** Update existing tests in `fix-loop-runner.test.ts` — they currently use `{ quality_assessment: { verdict: 'fail' } }` which masks the bug by matching the wrong code path
- **D-04:** Run-1774580045254 evidence: Coder build-fix loop showed 6/41 acceptance after 3 rounds with no improvement — fix loop never triggered because verdict was never found

### Bug 2: ShutdownCoordinator not wired (EXEC-05)
- **D-05:** `ShutdownCoordinator` exists at `shutdown-coordinator.ts` but is never instantiated in `index.ts`
- **D-06:** Must instantiate ShutdownCoordinator in `index.ts` and pass its `signal` (AbortSignal) to `createRunContext()`
- **D-07:** `createRunContext()` in `run-context.ts` already accepts optional `signal?: AbortSignal` — just need to pass it

### Bug 3: OutputGenerator uses legacy artifact API (EXEC-01)
- **D-08:** `OutputGenerator` at `output-generator.ts` imports `getArtifactsDir` and `readArtifact` from legacy `../../core/artifact.js`
- **D-09:** Legacy `getArtifactsDir()` returns default `.mosaic/artifacts` (missing run ID) because orchestrator uses ArtifactStore and never calls `initArtifactsDir()`
- **D-10:** This caused the deterministic ENOENT crash: writes to `.mosaic/artifacts/code/README.md` instead of `.mosaic/artifacts/run-{id}/code/README.md`
- **D-11:** Also caused `code.manifest.json` to have `"files": []` — manifest scanned wrong directory
- **D-12:** Fix: OutputGenerator constructor must accept `ArtifactIO` interface (from Phase 4) instead of importing legacy globals. CoderAgent passes its `ArtifactIO` instance when constructing OutputGenerator.

### Bug 4: PipelineEvents missing stage:skipped
- **D-13:** `stage:skipped` is emitted in `stage-executor.ts:41` with signature `(stage: StageName, runId: string)` but not declared in `PipelineEvents` interface at `event-bus.ts`
- **D-14:** Add `'stage:skipped'` to `PipelineEvents` with matching signature

### Claude's Discretion
- Exact refactoring approach for OutputGenerator (constructor injection vs method parameter)
- Whether to add integration tests beyond fixing existing unit tests
- Order of fixes (all are independent)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fix Loop & Stage Execution
- `src/core/fix-loop-runner.ts` — FixLoopRunner with wrong verdict path at line 106
- `src/core/stage-executor.ts` — StageExecutor with correct verdict path at line 202 (reference implementation)
- `src/core/__tests__/fix-loop-runner.test.ts` — Tests using wrong manifest structure
- `src/core/__tests__/stage-executor.test.ts` — Tests using correct manifest structure (line 180)

### Tester Manifest Schema
- `src/core/manifest.ts` — TestReportManifestSchema at line 125, verdict is top-level field
- `src/agents/tester.ts` — Tester writes manifest at line 174-181, verdict at top level

### ShutdownCoordinator Wiring
- `src/core/shutdown-coordinator.ts` — Full ShutdownCoordinator implementation
- `src/core/run-context.ts` — createRunContext() accepts optional signal at line 55
- `src/index.ts` — CLI entry point where ShutdownCoordinator must be instantiated

### OutputGenerator & Artifact Scoping
- `src/agents/coder/output-generator.ts` — Uses legacy getArtifactsDir() at lines 2, 24, 52
- `src/core/artifact.ts` — Legacy module with stale global state
- `src/core/artifact-store.ts` — Instance-scoped replacement (Phase 2)
- `src/agents/coder/types.ts` — ArtifactIO interface definition

### Event Types
- `src/core/event-bus.ts` — PipelineEvents interface missing stage:skipped

### Debug Evidence
- `.planning/debug/run-failure-analysis.md` — Full root cause analysis of run-1774580045254

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ArtifactIO` interface (from Phase 4 `src/agents/coder/types.ts`): Already used by CoderPlanner, CoderBuilder, BuildVerifier — OutputGenerator is the only holdout
- `StageExecutor.checkTesterFailed()` at `stage-executor.ts:202`: Uses correct `manifest?.verdict` path — can serve as reference for FixLoopRunner fix

### Established Patterns
- Phase 4 established constructor injection of `CoderDeps` (which includes `ArtifactIO`) for all sub-modules — OutputGenerator should follow the same pattern
- Phase 3 established `createRunContext()` as the single point where run-level dependencies are bundled — ShutdownCoordinator's signal fits naturally here

### Integration Points
- `index.ts` CLI entry: Where ShutdownCoordinator must be created before `orchestrator.run()`
- `CoderAgent.run()`: Where `ArtifactIO` must be passed to OutputGenerator constructor
- `fix-loop-runner.ts:106`: Single line change from `quality_assessment?.verdict` to `verdict`
- `event-bus.ts` PipelineEvents: Add one event signature

</code_context>

<specifics>
## Specific Ideas

- Run-1774580045254 showed all 10 modules built successfully, then crashed at output generation — 24 minutes of LLM work wasted across 3 retries
- QA Lead prompt was 127K tokens causing transient timeouts (not a code bug, but worth noting for prompt optimization)
- Coder build-fix loop showed no improvement across rounds (6/41 → 6/41 → 6/41) because fix loop never triggered — this is a direct consequence of Bug 1

</specifics>

<deferred>
## Deferred Ideas

- QA Lead prompt size optimization (127K tokens) — not a code bug, but affects reliability
- Coder acceptance test pass rate analysis — may need separate investigation into why only 6/41 passed even without fix loop

</deferred>

---

*Phase: 06-integration-wiring-fixes*
*Context gathered: 2026-03-27*
