---
phase: 7
slug: readme
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual diff review + grep verification |
| **Config file** | none — documentation phase |
| **Quick run command** | `grep -c "TODO" README.md README.en.md` |
| **Full suite command** | `diff <(grep -n "##" README.md) <(grep -n "##" README.en.md)` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `grep -c "TODO" README.md README.en.md`
- **After every plan wave:** Run section heading diff between README.md and README.en.md
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | D-01 | grep | `grep -c "circuit breaker" README.md` | ✅ | ⬜ pending |
| 07-01-02 | 01 | 1 | D-01 | grep | `grep -c "FixLoopRunner\|progressive" README.md` | ✅ | ⬜ pending |
| 07-01-03 | 01 | 1 | D-02 | diff | `diff <(grep -n "##" README.md) <(grep -n "##" README.en.md)` | ✅ | ⬜ pending |
| 07-01-04 | 01 | 1 | D-05 | grep | `grep -c "无限重试\|infinite retry" README.md README.en.md` (must be 0) | ✅ | ⬜ pending |
| 07-01-05 | 01 | 1 | D-07 | grep | `grep -c "banner.*TODO\|TODO.*banner" README.md` (must be 0) | ✅ | ⬜ pending |
| 07-01-06 | 01 | 1 | D-08 | grep | `grep -c "demo.*TODO\|TODO.*demo\|TODO.*GIF" README.md` (must be 0) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — this is a documentation-only phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Section ordering is logical for AI-savvy devs | D-06 | Subjective quality | Read through README top-to-bottom, verify demo/example appears before detailed architecture |
| Tone is technical, not marketing | D-05 | Subjective quality | Scan for marketing phrases ("revolutionary", "cutting-edge"), confirm technical language |
| Chinese/English READMEs have identical structure | D-02 | Structure comparison | Compare section headings side-by-side |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
