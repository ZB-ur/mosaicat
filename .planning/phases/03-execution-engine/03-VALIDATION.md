---
phase: 3
slug: execution-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | EXEC-01 | unit | `npx vitest run src/core/__tests__/stage-outcome.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | EXEC-05 | unit | `npx vitest run src/core/__tests__/stage-executor.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | EXEC-02 | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | EXEC-03 | unit | `npx vitest run src/core/__tests__/circuit-breaker.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | EXEC-04 | unit | `npx vitest run src/core/__tests__/shutdown-coordinator.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | EXEC-01 | integration | `npx vitest run src/core/__tests__/pipeline-loop.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/__tests__/stage-outcome.test.ts` — stubs for EXEC-01
- [ ] `src/core/__tests__/stage-executor.test.ts` — stubs for EXEC-05
- [ ] `src/core/__tests__/fix-loop-runner.test.ts` — stubs for EXEC-02
- [ ] `src/core/__tests__/circuit-breaker.test.ts` — stubs for EXEC-03
- [ ] `src/core/__tests__/shutdown-coordinator.test.ts` — stubs for EXEC-04
- [ ] `src/core/__tests__/pipeline-loop.test.ts` — stubs for EXEC-01 integration

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SIGINT graceful shutdown | EXEC-04 | Requires actual signal delivery | Send SIGINT during pipeline run, verify no partial artifacts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
