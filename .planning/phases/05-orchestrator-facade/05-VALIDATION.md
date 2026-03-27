---
phase: 5
slug: orchestrator-facade
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
---

# Phase 5 — Validation Strategy

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
| 05-01-01 | 01 | 1 | ORCH-02 | grep | `grep -rn 'console\.\(log\|warn\|error\)' src/ --include='*.ts' --exclude-dir='__tests__'` | ⬜ pending |
| 05-02-01 | 02 | 2 | ORCH-01, ORCH-03 | unit | `npx vitest run src/core/__tests__/orchestrator.test.ts` | ⬜ pending |

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
