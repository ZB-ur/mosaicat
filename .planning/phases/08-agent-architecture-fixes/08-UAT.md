---
status: complete
phase: 08-agent-architecture-fixes
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md]
started: 2026-03-28T18:30:00Z
updated: 2026-03-28T19:16:00Z
---

## Current Test

[testing complete]

## Tests

### 1. ToolUseAgent passes allowedTools to provider
expected: Run `npx vitest run src/agents/__tests__/tool-use-agent.test.ts` — all 5 tests pass. Key: allowedTools forwarded, no jsonSchema sent, artifact written from response.content.
result: pass

### 2. Researcher extends ToolUseAgent with manifest parsing
expected: Run `npx vitest run src/agents/__tests__/researcher.test.ts` — all 4 tests pass. Key: ResearcherAgent is instanceof ToolUseAgent, parseManifest extracts JSON from fenced code blocks.
result: pass

### 3. ProductOwner writes constitution.project.md
expected: Run `npx vitest run src/agents/__tests__/product-owner.test.ts` — all 4 tests pass. Key: constitution.project.md written when LLM returns constitution_project field, NOT written when absent or empty.
result: pass

### 4. TechLead appends to existing constitution
expected: Run `npx vitest run src/agents/__tests__/tech-lead.test.ts` — all 4 tests pass. Key: existing constitution preserved, TechLead update appended with separator.
result: pass

### 5. UXDesigner/APIDesigner prompts use JSON format
expected: Run `grep` — no HTML delimiters found, JSON "artifact" format present in both prompts.
result: pass

### 6. Manifest writeManifest rejects unregistered names
expected: Run `npx vitest run src/core/__tests__/manifest.test.ts` — all 7 tests pass. Key: unregistered .manifest.json throws, non-.manifest.json passes through.
result: pass

### 7. Hooks: placeholderCheck mandatory for ui_designer only
expected: Run `npx vitest run src/core/__tests__/hooks.test.ts` — all 6 tests pass. Key: ui_designer gets mandatory=true, coder gets mandatory=false.
result: pass

### 8. Full test suite regression check
expected: Run `npx vitest run` — ALL tests pass (no regressions from phase 8 changes). Zero test failures.
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
