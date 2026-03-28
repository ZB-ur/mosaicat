# Phase 10: Test Fix Loop Intelligence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-29
**Phase:** 10-test-fix-loop-intelligence
**Areas discussed:** Stagnation behavior, Classification integration, Pre-compilation scope, Visibility & reporting

---

## Stagnation Behavior

### Q1: When identical failure sets repeat for 2 rounds, what should happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Hard stop (Recommended) | Terminate immediately, produce stagnation report, mark as failed. Saves LLM cost. | |
| One more escalated attempt | Try one final round with full-history-fix before giving up. | |
| You decide | Claude picks. | |

**User's choice:** "5 轮渐进式修复" — Keep existing 5-round progressive strategy as upper bound, but add stagnation detection that terminates early when 2 consecutive identical failure sets detected.
**Notes:** User wants both mechanisms: round-based upper bound AND stagnation-based early termination.

### Q2: Stagnation report content?

| Option | Description | Selected |
|--------|-------------|----------|
| 简洁版 (Recommended) | Failed test list + error classification + repeated rounds + fix direction suggestion | ✓ |
| 详细版 | Full error output per round + attempted strategies + diff comparison | |
| You decide | Claude decides based on information volume | |

**User's choice:** 简洁版

---

## Classification Integration

### Q3: How should error classification interact with existing round strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| 分类优先 (Recommended) | Error type drives fix direction, round drives escalation intensity. Two-dimensional. | ✓ |
| 轮次优先 | Keep round strategy unchanged, classification only for logging/reporting. | |
| You decide | Claude decides based on implementation complexity. | |

**User's choice:** 分类优先

---

## Pre-compilation Scope

### Q4: tsc --noEmit scope?

| Option | Description | Selected |
|--------|-------------|----------|
| 仅测试文件 (Recommended) | Only test files in tests/acceptance/. Skip vitest on failure. | ✓ |
| 测试+被测代码 | Test files + their imported source. More thorough but slower. | |
| You decide | Claude decides based on tsconfig. | |

**User's choice:** 仅测试文件

---

## Visibility & Reporting

### Q5: Where should classification be visible?

| Option | Description | Selected |
|--------|-------------|----------|
| Pipeline 日志 | logger.pipeline() | ✓ |
| test-report.md | Classification summary in report | ✓ |
| CLI 进度事件 | eventBus.emit real-time | ✓ |
| retry-log.ts | New classification in errorCategory field | ✓ |

**User's choice:** All four channels selected.

---

## Claude's Discretion

- Exact stagnation comparison algorithm
- Internal data structures for classification
- Vitest output parsing patterns
- Stagnation fingerprint granularity

## Deferred Ideas

- "Improve pipeline artifact quality" todo — broader scope deferred, test-relevant parts addressed here
