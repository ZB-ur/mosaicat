---
phase: 10
slug: test-fix-loop-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts src/core/__tests__/failure-classifier.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/core/__tests__/fix-loop-runner.test.ts src/core/__tests__/failure-classifier.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | TEST-02 | unit | `npx vitest run src/core/__tests__/failure-classifier.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | TEST-01 | unit | `npx vitest run src/agents/__tests__/tester-precompile.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | TEST-03 | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | ✅ extend | ⬜ pending |
| 10-01-04 | 01 | 1 | TEST-04 | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/__tests__/failure-classifier.test.ts` — stubs for TEST-02 (classifyTestFailure, createFingerprint, fingerprintsMatch)
- [ ] `src/agents/__tests__/tester-precompile.test.ts` — stubs for TEST-01 (pre-compilation success/failure paths)
- [ ] Extend `src/core/__tests__/fix-loop-runner.test.ts` — stubs for TEST-03, TEST-04 (stagnation detection, strategy selection)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CLI progress shows error category | TEST-02 (D-09) | Requires visual terminal inspection | Run a pipeline with failing tests, verify `coder:fix-round` event shows error category in terminal output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
