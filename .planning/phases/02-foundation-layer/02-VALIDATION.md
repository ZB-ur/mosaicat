---
phase: 2
slug: foundation-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 2 — Validation Strategy

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
| 02-01-01 | 01 | 1 | STATE-01 | unit | `npx vitest run src/core/__tests__/artifact-store.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | STATE-02 | unit | `npx vitest run src/core/__tests__/artifact-store.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | ERR-01 | unit | `npx vitest run src/core/__tests__/error-handling.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | ERR-02 | unit | `npx vitest run src/core/__tests__/error-handling.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | ERR-03 | unit | `npx vitest run src/core/__tests__/context-manager.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | ERR-04 | unit | `npx vitest run src/core/__tests__/error-handling.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | STATE-03 | unit | `npx vitest run src/core/__tests__/config.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 2 | STATE-04 | unit | `npx vitest run src/core/__tests__/run-context.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | SEC-01 | unit | `npx vitest run src/agents/__tests__/security-auditor.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/__tests__/artifact-store.test.ts` — stubs for STATE-01, STATE-02
- [ ] `src/core/__tests__/error-handling.test.ts` — stubs for ERR-01, ERR-02, ERR-04
- [ ] `src/core/__tests__/context-manager.test.ts` — stubs for ERR-03
- [ ] `src/core/__tests__/config.test.ts` — stubs for STATE-03
- [ ] `src/core/__tests__/run-context.test.ts` — stubs for STATE-04
- [ ] `src/agents/__tests__/security-auditor.test.ts` — stubs for SEC-01

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Config freeze prevents runtime mutation | STATE-03 | Requires runtime Object.freeze verification | Attempt `config.foo = 'bar'` after freeze, verify TypeError thrown |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
