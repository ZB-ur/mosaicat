# Phase 6: Integration Wiring Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 06-integration-wiring-fixes
**Areas discussed:** Fix loop verdict, OutputGenerator wiring, ShutdownCoordinator wiring, PipelineEvents type

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Fix loop verdict path | FixLoopRunner reads quality_assessment?.verdict but tester writes top-level verdict | |
| OutputGenerator wiring | Uses legacy getArtifactsDir() causing ENOENT crash | |
| ShutdownCoordinator wiring | Class exists but never instantiated in index.ts | |
| I'm ready for context | All 4 bugs are clear from the run analysis | ✓ |

**User's choice:** Skip discussion — all 4 bugs confirmed via run-1774580045254 debug analysis and code inspection.
**Notes:** User provided detailed run output showing: (1) ENOENT crash on `.mosaic/artifacts/code/README.md`, (2) Coder acceptance 6/41 after 3 rounds with no improvement. Debug session `.planning/debug/run-failure-analysis.md` already completed root cause analysis.

---

## Claude's Discretion

- Exact refactoring approach for OutputGenerator (constructor injection vs method parameter)
- Whether to add integration tests beyond fixing existing unit tests
- Order of fixes (all are independent)

## Deferred Ideas

- QA Lead prompt size optimization (127K tokens causing transient timeouts)
- Coder acceptance test pass rate deep analysis
