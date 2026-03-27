---
phase: 6
slug: integration-wiring-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | EXEC-02 | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts` | ✅ | ⬜ pending |
| 06-01-02 | 01 | 1 | EXEC-05 | unit | `npx vitest run src/core/__tests__/shutdown-coordinator.test.ts` | ✅ | ⬜ pending |
| 06-01-03 | 01 | 1 | EXEC-01 | unit | `npx vitest run src/agents/__tests__/coder.test.ts` | ✅ | ⬜ pending |
| 06-01-04 | 01 | 1 | n/a | compile | `npx tsc --noEmit` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. All test files already exist:
- `src/core/__tests__/fix-loop-runner.test.ts` — FixLoopRunner tests (need manifest structure fix)
- `src/core/__tests__/shutdown-coordinator.test.ts` — ShutdownCoordinator tests
- `src/core/__tests__/stage-executor.test.ts` — StageExecutor tests (reference for correct verdict path)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGINT graceful shutdown E2E | EXEC-05 | Requires signal delivery to running process | Start pipeline, send SIGINT, verify current stage completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
