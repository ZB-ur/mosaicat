---
created: 2026-03-28T04:26:04.538Z
title: Improve pipeline artifact quality
area: pipeline
files:
  - src/agents/coder.ts
  - src/agents/coder/coder-builder.ts
  - src/agents/tester.ts
  - src/core/fix-loop-runner.ts
---

## Problem

Run analysis of run-1774640936546 revealed systemic quality issues in pipeline-generated artifacts:

1. **13 placeholder components** — Coder outputs `<div>ComponentName</div>` stubs for user-facing components (BotThinkingIndicator, WinnerBanner, DecisionDetailPanel, PLChart, etc.), making Lobby/Replay/Stats pages non-functional. Manifest only checks file existence, not content quality.

2. **Test infrastructure broken** — 14/16 test files fail at parse time (TSX syntax in non-JSX test environment). Tester reports parse errors and assertion failures identically, preventing Coder from diagnosing the actual problem.

3. **Fix loop completely ineffective** — All 5 rounds (direct-fix x2, replan x1, full-history x2) produced identical failure sets. No stagnation detection, no early abort. Wasted ~31 minutes of LLM time.

4. **Malformed path generation** — Directory named `{src` with brace-suffixed subdirectories (`components}`, `engine}`, `services}`) exists in code output, likely from JSON template expansion bug in Coder.

## Solution

Planned improvements for next milestone:

1. **Manifest content validation** — Add content quality checks beyond file existence (minimum line count, detect stub patterns like `<div>Name</div>`)
2. **Tester error classification** — Separate parse/compile errors from assertion failures in test reports, so Coder can target the right fix strategy
3. **Fix loop stagnation detection** — Track failure signatures per round; abort early if identical failures repeat 2+ rounds
4. **Fix loop early abort** — If all failures are parse errors (not code logic), switch strategy to fix build config rather than code
5. **Coder path sanitization** — Validate generated file paths before writing; reject paths containing `{` or `}` characters
