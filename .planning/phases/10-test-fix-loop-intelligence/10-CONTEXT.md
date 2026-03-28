# Phase 10: Test Fix Loop Intelligence - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the Tester-Coder fix loop smarter: add pre-compilation checks before running vitest, classify test failures into categories, detect stagnation (identical failure sets repeating), and route fix strategy based on error type rather than only round number.

</domain>

<decisions>
## Implementation Decisions

### Stagnation Detection & Behavior
- **D-01:** Keep the existing 5-round progressive strategy (direct-fix -> replan-failed-modules -> full-history-fix) as the upper bound
- **D-02:** Add stagnation detection: when identical failure sets repeat for 2 consecutive rounds, terminate early and produce a stagnation report
- **D-03:** Stagnation report format: concise — failed test list + error classification + which rounds repeated + suggested manual fix direction. Written to `stagnation-report.md` artifact

### Classification Integration
- **D-04:** Error classification is the primary axis for fix strategy selection. Three categories: parse/import error, assertion failure, runtime error
- **D-05:** Classification drives fix direction: parse/import errors -> config/dependency fixes; assertion errors -> logic fixes; runtime errors -> environment/setup fixes
- **D-06:** Round number drives escalation intensity (existing progressive strategy), classification drives fix direction. Two dimensions combined: `(error_type, round) -> strategy`

### Pre-compilation Scope
- **D-07:** `tsc --noEmit` runs only on test files (tests/acceptance/ directory) before invoking vitest
- **D-08:** If pre-compilation fails, skip vitest entirely and report the failure as parse/import error category. Saves time and tokens on unfixable infrastructure issues

### Visibility & Reporting
- **D-09:** Error classification visible in ALL four channels:
  1. Pipeline logs (`logger.pipeline()`) — classification result per round
  2. `test-report.md` — classification summary section added to report
  3. CLI progress events (`eventBus.emit`) — real-time classification in terminal
  4. `retry-log.ts` — `errorCategory` field uses new classification (replaces generic 'test-failure')

### Claude's Discretion
- Exact comparison algorithm for "identical failure sets" (string match, test name set, or error category fingerprint)
- Internal data structures for failure classification
- How to extract error type from vitest output (regex patterns, exit codes, etc.)
- Whether stagnation detection compares full failure output or just test names + error types

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fix Loop Architecture
- `src/core/fix-loop-runner.ts` — Current Tester-Coder fix loop implementation (progressive strategy, round tracking, failure history injection)
- `src/core/stage-executor.ts` — Stage execution engine that fix loop calls into
- `src/core/retry-log.ts` — Retry logging with errorCategory field (to be extended with new classification)

### Test Execution
- `src/agents/tester.ts` — Tester agent that runs vitest and generates test-report.md + manifest
- `src/agents/qa-lead.ts` — QALead generates test plans consumed by Tester
- `src/agents/coder/build-verifier.ts` — Coder's internal verify-fix loop (separate, but pattern reference)

### Event System
- `src/core/event-bus.ts` — EventBus with typed events including `coder:fix-round`
- `src/core/cli-progress.ts` — CLI progress display subscribing to events

### Pipeline State
- `src/core/pipeline-loop.ts` — Pipeline execution loop that triggers fix-loop-runner
- `src/core/stage-outcome.ts` — Stage outcome types

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FixLoopRunner` class — already has round tracking, progressive strategy, failure history injection. Extend rather than rewrite
- `logRetry()` in `retry-log.ts` — already has `errorCategory` field, just needs new classification values
- `eventBus.emit('coder:fix-round', ...)` — existing event for fix loop progress

### Established Patterns
- Fix loop is decoupled from PipelineLoop (no index manipulation)
- State saving via `onStateSave` callback per round
- Failure history accumulated in `attemptHistory` array and written to `fix-attempt-history.md`
- Tester reads `test-plan.manifest.json` for commands, runs vitest, generates report

### Integration Points
- `FixLoopRunner.run()` — main entry point to extend with classification and stagnation
- `TesterAgent.run()` — pre-compilation check inserts before `this.runTests()`
- `TesterAgent.generateReport()` — add classification summary to test-report.md
- `FixLoopRunner.selectApproach()` — modify to accept error classification as input

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for failure classification and stagnation detection.

</specifics>

<deferred>
## Deferred Ideas

- "Improve pipeline artifact quality" (todo) — broader artifact quality improvements beyond test fix loop. Relevant parts (test quality) are addressed in this phase; remaining scope deferred.

</deferred>

---

*Phase: 10-test-fix-loop-intelligence*
*Context gathered: 2026-03-29*
