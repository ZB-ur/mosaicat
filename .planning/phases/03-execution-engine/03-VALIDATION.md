---
phase: 3
slug: execution-engine
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-27
updated: 2026-03-27
---

# Phase 3 — Validation Strategy

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
| 03-01-01 | 01 | 1 | EXEC-04, EXEC-05 | unit | `npx vitest run src/core/__tests__/retrying-provider.test.ts -x` | ⬜ pending |
| 03-01-02 | 01 | 1 | EXEC-04 | unit | `npx vitest run src/core/__tests__/shutdown-coordinator.test.ts -x` | ⬜ pending |
| 03-02-01 | 02 | 2 | EXEC-03 | unit | `npx vitest run src/core/__tests__/stage-executor.test.ts -x` | ⬜ pending |
| 03-03-01 | 03 | 3 | EXEC-01, EXEC-02 | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | ⬜ pending |
| 03-03-02 | 03 | 3 | EXEC-01, EXEC-02, EXEC-03 | unit+integration | `npx vitest run src/core/__tests__/pipeline-loop.test.ts -x` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 / Nyquist Compliance Note

All plans in this phase use `tdd="true"` on their tasks, which means tests are written **before** implementation code within each task (RED-GREEN-REFACTOR cycle). This satisfies the Nyquist rule -- every task has an `<automated>` verify command pointing to a test file that the task itself creates.

No separate Wave 0 plan is needed because test creation is embedded in each task's TDD workflow. The test files are:

- `src/core/__tests__/retrying-provider.test.ts` -- created by 03-01 Task 1
- `src/core/__tests__/shutdown-coordinator.test.ts` -- created by 03-01 Task 2
- `src/core/__tests__/stage-executor.test.ts` -- created by 03-02 Task 1
- `src/core/__tests__/fix-loop-runner.test.ts` -- created by 03-03 Task 1
- `src/core/__tests__/pipeline-loop.test.ts` -- created by 03-03 Task 2

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGINT graceful shutdown | EXEC-04 | Requires actual signal delivery | Send SIGINT during pipeline run, verify no partial artifacts |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] TDD-within-tasks satisfies Wave 0 (no separate scaffold needed)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
