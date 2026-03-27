# Phase 1: Test Infrastructure Hardening - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the test suite trustworthy as a safety net for the v2 rewrite. Replace all `as any` casts with typed mock factories, add resume integration tests covering all recent changes, create a full 13-stage canary E2E test with deterministic LLM stubs, and establish coverage measurement with baseline enforcement.

</domain>

<decisions>
## Implementation Decisions

### Mock Factory Design
- **D-01:** Use partial override pattern: `createMockProvider({ generate: vi.fn().mockResolvedValue(...) })` with sensible defaults for all methods. Tests only override what they care about.
- **D-02:** Create `createTestContext()` factory that bundles provider + logger + config with typed defaults, replacing all 6 instances of `provider as any, logger as any` across test files.
- **D-03:** Place factories in `src/__tests__/test-helpers.ts` (extend existing file, don't create new).

### Resume Test Scope
- **D-04:** Cover 5 resume scenarios: (1) basic resume from last completed stage, (2) `--from` stage reset with artifact cleanup, (3) provider name display shows actual LLM name not 'resume', (4) cached stage display shows 'cached' not 'done (?)', (5) verify no unexpected files are deleted during resume/reset.
- **D-05:** Use minimal mocks (mock artifact layer and pipeline state), test resume logic in isolation. Integration-level resume tests will be added in Phase 2 after ArtifactStore rewrite.

### Canary Test Strategy
- **D-06:** Canary test covers full 13-stage pipeline (full profile), not just design-only subset.
- **D-07:** Use deterministic `StubProvider` — pre-written JSON fixtures for each stage's expected LLM response. No real LLM calls.
- **D-08:** Verify artifacts land on disk in correct directories with expected structure after full pipeline run.

### Coverage Policy
- **D-09:** Phase 1: Measure current baseline, enforce "no drop below baseline" in vitest config.
- **D-10:** Phase 5 (after rewrite completes): Raise coverage threshold to 80% lines.
- **D-11:** Generate coverage reports in CI for visibility from Phase 1 onward.

### Claude's Discretion
- Mock factory internal implementation details (how defaults are structured)
- Canary test fixture format (inline JSON vs external .json files)
- Coverage tool choice (vitest built-in c8/v8 vs istanbul)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Test Infrastructure
- `src/__tests__/test-helpers.ts` -- Existing test helper utilities (createTestMosaicDir, cleanupTestMosaicDir) to extend
- `vitest.config.ts` -- Current test configuration (fileParallelism: false, no coverage)
- `src/core/types.ts` -- LLMProvider interface definition (mock must conform to this)
- `src/core/logger.ts` -- Logger class (mock must conform to this interface)

### Resume Implementation
- `src/core/orchestrator.ts` lines 236-350 -- resumeRun() method to test
- `src/core/resume.ts` -- Resume helper logic
- Commits 3df1c3e, 0cf7b66, e2b62b4 -- Recent resume fixes that need test coverage

### Existing E2E Tests (to learn patterns from)
- `src/__tests__/e2e-phase3.test.ts` -- Existing E2E pattern (uses as any, needs migration)
- `src/__tests__/e2e-phase4.test.ts` -- Existing E2E pattern
- `src/__tests__/e2e-phase5.test.ts` -- Existing E2E pattern

### Pipeline Configuration
- `config/pipeline.yaml` -- Stage definitions, gate config, retry settings
- `config/agents.yaml` -- Agent input/output contracts (needed for stub responses)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/__tests__/test-helpers.ts`: Has `createTestMosaicDir()` and `cleanupTestMosaicDir()` for temp directory management. Extend this file with mock factories.
- `StubProvider` concept: Used in some test setups for deterministic LLM responses.
- 3 existing E2E tests (e2e-phase3/4/5): Patterns for pipeline setup, stage execution, artifact verification.

### Established Patterns
- `fileParallelism: false` in vitest config because tests share `.mosaic/` state via artifact module globals. This constraint remains until Phase 2 introduces ArtifactStore.
- `describe` / `beforeEach` / `afterEach` with tmpRoot setup/cleanup pattern used consistently.
- Agent construction: `new AgentClass(stage, provider, logger)` — mock factories must match this signature.

### Integration Points
- 6 files need `as any` replacement: `e2e-phase3.test.ts`, `e2e-phase4.test.ts`, `e2e-phase5.test.ts`, `tools.test.ts`, `run-manager.test.ts`, `orchestrator-integration.test.ts`
- `security.test.ts` has `stages: {} as any` — separate pattern, also needs typed mock.
- `anthropic-sdk.test.ts` has `import ... as any` — SDK mock pattern, different from agent mocks.

</code_context>

<specifics>
## Specific Ideas

- User emphasizes: resume tests must verify no unexpected files are deleted during `--from` reset. This is a safety concern for the rewrite — artifact cleanup must be precise.
- Coverage strategy is explicitly two-phase: baseline now, 80% threshold after Phase 5. This avoids Phase 1 being blocked by legacy code coverage gaps.
- User chose full 13-stage canary despite higher effort — values comprehensive safety net over speed.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-test-infrastructure-hardening*
*Context gathered: 2026-03-26*
