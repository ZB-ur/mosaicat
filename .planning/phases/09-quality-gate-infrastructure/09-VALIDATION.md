---
phase: 9
slug: quality-gate-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/core/__tests__/ast-quality-gate.test.ts src/core/__tests__/manifest-quality-gate.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/core/__tests__/ast-quality-gate.test.ts src/core/__tests__/hooks.test.ts --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | GATE-01 | unit | `npx vitest run src/core/__tests__/ast-quality-gate.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | GATE-02 | unit | `npx vitest run src/core/__tests__/ast-quality-gate.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | GATE-03 | unit | `npx vitest run src/core/__tests__/manifest-quality-gate.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 2 | GATE-04 | unit | `npx vitest run src/core/__tests__/feature-coverage-check.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-04-01 | 04 | 2 | GATE-05 | unit | `npx vitest run src/agents/__tests__/validator-quality.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/__tests__/ast-quality-gate.test.ts` — stubs for GATE-01, GATE-02 (AST stub detection logic)
- [ ] `src/core/__tests__/manifest-quality-gate.test.ts` — stubs for GATE-03 (implementation_status in manifest)
- [ ] `src/core/__tests__/feature-coverage-check.test.ts` — stubs for GATE-04 (PRD feature coverage)
- [ ] `src/agents/__tests__/validator-quality.test.ts` — stubs for GATE-05 (Validator aggregation)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
