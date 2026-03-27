# Phase 1: Test Infrastructure Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 01-test-infrastructure-hardening
**Areas discussed:** Resume test scope, Mock factory design, Canary test strategy, Coverage policy

---

## Resume Test Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Basic resume | Interrupt then continue from last completed stage | |
| --from stage reset | Specify restart stage, verify artifact cleanup | |
| Provider name display | Show actual LLM provider name not 'resume' | |
| Cached stage display | Show 'cached' not 'done (?)' for skipped stages | |
| All of the above + file safety | All 4 scenarios + verify no unexpected file deletion | ✓ |

**User's choice:** All 4 scenarios plus explicit verification that no unexpected files are deleted during resume/reset.
**Notes:** User emphasized file safety as a critical concern for the rewrite.

### Follow-up: Mock depth for resume tests

| Option | Description | Selected |
|--------|-------------|----------|
| Real modules (Recommended) | Real artifact I/O, real pipeline state machine, only stub LLM | |
| Minimal mocks | Mock artifact layer and pipeline state, test resume logic in isolation | ✓ |

**User's choice:** Minimal mocks
**Notes:** Integration-level resume tests deferred to Phase 2 after ArtifactStore rewrite.

---

## Mock Factory Design

| Option | Description | Selected |
|--------|-------------|----------|
| Partial overrides (Recommended) | createMockProvider({ generate: vi.fn()... }) with defaults + per-method override | ✓ |
| Fixed complete mock | Fixed structure, no per-method override | |

**User's choice:** Asked for recommendation, accepted partial overrides.
**Notes:** User deferred to Claude's recommendation. Rationale: future interface changes only require updating defaults, not all test files.

---

## Canary Test Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Design-only profile (7 stages) | Fastest, covers core pipeline flow | |
| Full profile (13 stages) | All 13 stages end-to-end, most thorough | ✓ |
| Claude's discretion | Let Claude decide | |

**User's choice:** Full 13 stages. Initially asked for recommendation (Claude suggested 7), then explicitly chose full 13.
**Notes:** User also confirmed: no real LLM calls, use StubProvider with deterministic fixtures.

---

## Coverage Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, basic thresholds | Set baseline and enforce in CI | |
| Track but don't enforce | Reports only, no gate | |
| Skip for now | No coverage tooling | |
| Baseline first, 80% later | Phase 1: baseline enforcement. Phase 5: raise to 80% | ✓ |

**User's choice:** Initially said "80% from start", then accepted two-phase approach after Claude explained legacy code blocking risk.
**Notes:** User's goal is preventing code rot. Two-phase coverage gives immediate visibility while avoiding false blocks.

---

## Claude's Discretion

- Mock factory internal implementation details
- Canary test fixture format
- Coverage tool choice

## Deferred Ideas

None — discussion stayed within phase scope.
