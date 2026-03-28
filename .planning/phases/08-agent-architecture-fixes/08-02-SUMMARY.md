---
phase: 08-agent-architecture-fixes
plan: 02
subsystem: agents
tags: [constitution, prompt-format, product-owner, tech-lead, ux-designer, api-designer]
dependency_graph:
  requires: []
  provides: [constitution-persistence, json-output-format]
  affects: [downstream-agents, ux-designer, api-designer]
tech_stack:
  added: []
  patterns: [agent-run-override, json-schema-extension]
key_files:
  created:
    - src/agents/__tests__/product-owner.test.ts
    - src/agents/__tests__/tech-lead.test.ts
  modified:
    - src/agents/product-owner.ts
    - src/agents/tech-lead.ts
    - .claude/agents/mosaic/ux-designer.md
    - .claude/agents/mosaic/api-designer.md
decisions:
  - "Override run() in ProductOwner/TechLead instead of modifying LLMAgent base class -- keeps LLMAgent frozen per CLAUDE.md"
  - "Use eventBus singleton (not context property) -- matches existing LLMAgent pattern"
metrics:
  duration: 8min
  completed: "2026-03-28T09:58:00Z"
---

# Phase 08 Plan 02: Constitution Persistence + Prompt Format Fix Summary

ProductOwner/TechLead override run() to persist constitution.project.md; UX/API designer prompts replaced HTML delimiters with JSON format matching LLMAgent jsonSchema.

## What Was Done

### Task 1: ProductOwner + TechLead constitution persistence (TDD)

**ProductOwner** (`src/agents/product-owner.ts`): Extended from 11 lines to ~80 lines. Overrides `run()` with custom JSON schema that includes `constitution_project` field. When LLM returns this field non-empty, writes `constitution.project.md` to disk via `writeOutput()`.

**TechLead** (`src/agents/tech-lead.ts`): Same pattern but reads existing `constitution.project.md` from `context.inputArtifacts`, appends its `constitution_project_update` content with `\n\n` separator, writes combined file.

**Tests**: 8 tests total (4 per agent) covering: constitution written when present, NOT written when absent/empty, normal artifact+manifest writing unaffected, TechLead append behavior with/without existing constitution.

### Task 2: UXDesigner + APIDesigner prompt output format

Replaced HTML comment delimiter output instructions (`<!-- ARTIFACT:... -->`, `<!-- MANIFEST:... -->`, `<!-- CLARIFICATION -->`) with JSON object format (`{ "artifact": "...", "manifest": {...}, "clarification": "..." }`) matching LLMAgent's jsonSchema enforcement.

## Decisions Made

1. **Override run() pattern**: Keeps LLMAgent frozen (per CLAUDE.md module boundary rules) while adding constitution-specific fields to the JSON schema
2. **eventBus singleton**: Used global `eventBus` import instead of context property (AgentContext has no eventBus field)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test fixture data schema mismatch**
- **Found during:** Task 1 RED phase
- **Issue:** Test mock manifest data didn't match `TechSpecManifestSchema` (requires objects with name/description/covers_features, not plain strings) and `PrdManifestSchema` (requires constraints/out_of_scope arrays)
- **Fix:** Updated test fixtures to match actual Zod schemas from `manifest.ts`
- **Files modified:** `src/agents/__tests__/tech-lead.test.ts`, `src/agents/__tests__/product-owner.test.ts`

**2. [Rule 3 - Blocking] Missing initArtifactsDir() in tests**
- **Found during:** Task 1 GREEN phase
- **Issue:** `writeArtifact()` uses module-level `currentRunDir` which defaults to base dir; tests need `initArtifactsDir('test-run')` to set the correct run directory
- **Fix:** Added `initArtifactsDir('test-run')` to beforeEach in both test files

**3. [Rule 2 - Missing] Plan referenced this.ctx.eventBus which doesn't exist**
- **Found during:** Task 1 implementation
- **Issue:** Plan code used `this.ctx.eventBus` but `AgentContext` has no `eventBus` property
- **Fix:** Used `eventBus` singleton import from `core/event-bus.js` matching existing LLMAgent pattern

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `cd7fc93` | test | Add failing tests for constitution persistence (TDD RED) |
| `453b2ee` | feat | Implement constitution persistence in ProductOwner and TechLead (TDD GREEN) |
| `b5ca3dc` | fix | Replace HTML delimiter output format with JSON in UX/API designer prompts |

## Known Stubs

None -- all implementations are complete with real logic.

## Verification Results

- 8/8 tests pass (product-owner: 4, tech-lead: 4)
- No type errors in modified files (pre-existing error in run-manager.ts is out of scope)
- constitution.project.md persistence confirmed via grep
- No HTML delimiters remain in UX/API designer prompts
- JSON "artifact"/"manifest" format present in both prompt files

## Self-Check: PASSED

All 6 created/modified files found on disk. All 3 commits verified in git log.
