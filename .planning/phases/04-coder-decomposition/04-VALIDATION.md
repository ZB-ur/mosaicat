---
phase: 4
slug: coder-decomposition
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 04-01-01 | 01 | 1 | CODER-01 | unit | `npx vitest run src/agents/__tests__/coder-planner.test.ts` | ⬜ pending |
| 04-01-02 | 01 | 1 | CODER-04 | unit | `npx vitest run src/agents/__tests__/smoke-runner.test.ts` | ⬜ pending |
| 04-02-01 | 02 | 1 | CODER-02 | unit | `npx vitest run src/agents/__tests__/coder-builder.test.ts` | ⬜ pending |
| 04-02-02 | 02 | 1 | CODER-03, TEST-04 | unit | `npx vitest run src/agents/__tests__/build-verifier.test.ts` | ⬜ pending |
| 04-03-01 | 03 | 2 | CODER-05 | unit+integration | `npx vitest run src/agents/__tests__/coder-facade.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 / Nyquist Compliance Note

All plans use TDD within each task — tests written before implementation code. No separate Wave 0 needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | — | All behaviors have automated verification |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] TDD-within-tasks satisfies Wave 0
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
