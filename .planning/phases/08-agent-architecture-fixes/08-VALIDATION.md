---
phase: 8
slug: agent-architecture-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
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
| 08-01-01 | 01 | 1 | AGENT-01 | unit | `npx vitest run src/agents/__tests__/tool-use-agent.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | AGENT-02 | unit | `npx vitest run src/agents/__tests__/researcher.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | AGENT-03 | unit | `npx vitest run src/agents/__tests__/constitution.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | AGENT-04 | unit | `npx vitest run src/agents/__tests__/output-format.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | AGENT-05 | unit | `npx vitest run src/core/__tests__/manifest.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 2 | AGENT-06 | unit | `npx vitest run src/core/__tests__/hooks.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/agents/__tests__/tool-use-agent.test.ts` — stubs for AGENT-01
- [ ] `src/agents/__tests__/researcher.test.ts` — stubs for AGENT-02
- [ ] `src/agents/__tests__/constitution.test.ts` — stubs for AGENT-03
- [ ] `src/agents/__tests__/output-format.test.ts` — stubs for AGENT-04
- [ ] `src/core/__tests__/manifest.test.ts` — stubs for AGENT-05
- [ ] `src/core/__tests__/hooks.test.ts` — stubs for AGENT-06

*Existing vitest infrastructure covers framework needs. Only test file stubs are required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Researcher returns real web search results | AGENT-02 | Requires live LLM + web search API | Run pipeline with researcher stage, verify output contains URLs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
