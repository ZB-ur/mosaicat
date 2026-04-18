# Phase 8: Agent Architecture Fixes - Research

**Researched:** 2026-03-28
**Domain:** Agent execution layer -- tool-use mode, constitution persistence, output format alignment, manifest validation, hook activation
**Confidence:** HIGH

## Summary

Phase 8 fixes six distinct bugs/gaps in the agent execution layer. All issues are well-scoped: the provider layer already supports `allowedTools`, the hook system is implemented but under-registered, manifest schemas exist but validation may not throw on missing schemas, and constitution persistence is simply not wired. The biggest new work is creating `ToolUseAgent` as a sibling to `LLMAgent`, both extending `BaseAgent`.

The UXDesigner/APIDesigner output format contradiction is clear: their prompts instruct HTML comment delimiters (`<!-- ARTIFACT:... -->`) while `LLMAgent.run()` expects JSON with `{artifact, manifest}` fields enforced via `--json-schema`. The prompts must be updated to match the JSON output pattern used by all other LLMAgent subclasses.

**Primary recommendation:** Implement in dependency order: ToolUseAgent base class first, then Researcher migration, then constitution persistence (ProductOwner/TechLead), then output format fixes, then manifest/hook hardening.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create `ToolUseAgent extends BaseAgent` as a new base class parallel to `LLMAgent`. Separation of concerns: LLMAgent = structured JSON output, ToolUseAgent = tool calls + final text as artifact.
- **D-02:** ToolUseAgent output strategy is "tool results + final text" -- LLM calls tools freely, final response text becomes artifact content. Manifest handled by subclass.
- **D-03:** ToolUseAgent reads `allowed_tools` from `agents.yaml` via `context.task.autonomy.allowed_tools` (already passed through `stageConfig.autonomy`).
- **D-04:** Researcher agent changes from `LLMAgent` to `ToolUseAgent` with web search tools.

### Claude's Discretion
- Constitution persistence implementation: ProductOwner/TechLead `constitution_project` field written to disk, path consistent with `resume.ts` (`constitution.project.md`), loadable by `context-manager.ts`.
- UXDesigner/APIDesigner format fix: decide whether to fix prompts or code based on minimal change principle.
- Manifest validation + hook activation: decide which hooks are mandatory vs warning.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGENT-01 | LLMAgent's `allowed_tools` config works, supporting tool use alongside or instead of structured output | ToolUseAgent base class handles tool-use mode; LLMAgent stays pure structured output. Provider layer already supports `allowedTools` in `LLMCallOptions`. |
| AGENT-02 | Researcher becomes tool-use agent calling WebSearch/WebFetch for real searches | Researcher currently extends LLMAgent (12 lines). Change to extend ToolUseAgent. `agents.yaml` already has `allowed_tools: [WebSearch, WebFetch]`. |
| AGENT-03 | ProductOwner/TechLead `constitution_project` persisted to disk, downstream agents consume it | ProductOwner prompt outputs `constitution_project` field in JSON. LLMAgent only parses `artifact`+`manifest` -- the field is silently dropped. Need to override `run()` or post-process parsed JSON. |
| AGENT-04 | UXDesigner/APIDesigner output format unified (no prompt vs implementation contradictions) | Prompts use HTML comment delimiters; LLMAgent uses `--json-schema`. Fix prompts to use JSON format matching other LLMAgent subclasses. |
| AGENT-05 | All manifest types have Zod schema, writes validated | `manifest.ts` already has schemas for all 11 manifest types and `writeManifest()` calls `schema.parse()`. The gap is that `schema.parse()` is only called when a schema exists in `MANIFEST_SCHEMAS` -- verify all paths are covered. |
| AGENT-06 | BaseAgent hooks activated -- placeholder detection, F-NNN coverage verification fire after execution | `getHooksForStage()` registers hooks per stage. Hooks exist but all are `mandatory: false`. Need to decide which to make mandatory and verify `lastOutput` is populated correctly. |
</phase_requirements>

## Standard Stack

No new libraries needed. All work uses existing codebase modules.

### Core (existing, no changes)
| Module | Purpose | Status |
|--------|---------|--------|
| `src/core/agent.ts` | BaseAgent with hook system | FROZEN -- interface stable |
| `src/agents/llm-agent.ts` | LLMAgent structured output base | Stays unchanged |
| `src/core/llm-provider.ts` | LLMProvider interface with `allowedTools` | FROZEN |
| `src/core/manifest.ts` | Manifest schemas + validated read/write | Needs audit |
| `src/core/hooks/index.ts` | Hook registration per stage | Needs updates |

### New Files
| File | Purpose |
|------|---------|
| `src/agents/tool-use-agent.ts` | ToolUseAgent base class |
| `src/agents/__tests__/tool-use-agent.test.ts` | Unit tests for ToolUseAgent |

## Architecture Patterns

### ToolUseAgent Design (AGENT-01, AGENT-02)

**What:** New abstract class `ToolUseAgent extends BaseAgent` that runs LLM with tool-use mode (no `jsonSchema`), collects final text response as artifact content.

**Key differences from LLMAgent:**

| Aspect | LLMAgent | ToolUseAgent |
|--------|----------|--------------|
| LLM call mode | `jsonSchema` (structured output) | `allowedTools` (tool use) |
| Output parsing | JSON `{artifact, manifest}` | Final text = artifact content |
| Manifest | From parsed JSON `manifest` field | Subclass responsibility |
| Clarification | JSON `clarification` field | Not applicable (tool-use agents don't do clarification) |

**Template method pattern:**
```typescript
// src/agents/tool-use-agent.ts
export interface ToolUseOutputSpec {
  artifacts: string[];        // file names to write
  manifest?: string;          // manifest file name (subclass writes)
}

export abstract class ToolUseAgent extends BaseAgent {
  abstract getToolUseSpec(): ToolUseOutputSpec;

  /** Subclasses may override to add extra prompt sections */
  protected buildToolPrompt(context: AgentContext): string {
    return assemblePrompt(context, this.getToolUseSpec());
  }

  /** Subclasses override to parse manifest from final text or tool results */
  protected parseManifest(_finalText: string): unknown | undefined {
    return undefined;
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getToolUseSpec();
    const prompt = this.buildToolPrompt(context);
    const tools = context.task.autonomy?.allowed_tools ?? [];

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
      allowedTools: tools,
      maxBudgetUsd: context.task.autonomy?.max_budget_usd,
      timeoutMs: 600_000,
    });

    const finalText = response.content;

    // Write primary artifact
    if (spec.artifacts.length > 0) {
      this.writeOutput(spec.artifacts[0], finalText);
    }

    // Let subclass handle manifest
    if (spec.manifest) {
      const manifestData = this.parseManifest(finalText);
      if (manifestData) {
        this.writeOutputManifest(spec.manifest, manifestData);
      }
    }
  }
}
```

**Pattern reference:** `QALeadAgent` (line 85-89) already uses this exact pattern -- `provider.call()` with `allowedTools` and no `jsonSchema`. ToolUseAgent extracts this into a reusable base class.

### Researcher as ToolUseAgent (AGENT-02)

```typescript
// src/agents/researcher.ts (rewritten)
export class ResearcherAgent extends ToolUseAgent {
  getToolUseSpec(): ToolUseOutputSpec {
    return {
      artifacts: ['research.md'],
      manifest: 'research.manifest.json',
    };
  }

  protected parseManifest(finalText: string): unknown | undefined {
    // Extract JSON manifest block from final text
    // Pattern: look for ```json block or parse structured section
    const jsonMatch = finalText.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
    }
    return undefined;
  }
}
```

**Important:** The Researcher prompt currently expects `{artifact, manifest}` JSON output (same as LLMAgent). When switching to ToolUseAgent, the prompt must be updated to instruct the LLM to:
1. Use WebSearch/WebFetch tools to gather real data
2. Output the final research.md as plain text (the artifact)
3. Include a JSON manifest block at the end

### Constitution Persistence (AGENT-03)

**Current state:**
- ProductOwner prompt asks LLM to output `constitution_project` as a third JSON field
- TechLead prompt asks for `constitution_project_update`
- `LLMAgent.run()` only parses `artifact` and `manifest` -- the constitution field is silently dropped
- `resume.ts:113` lists `constitution.project.md` as a product_owner output
- `agents.yaml` lists `constitution.project.md` in both product_owner and tech_lead outputs
- Downstream agents (coder, qa_lead, tester, etc.) list `constitution.project.md` as input
- `context-manager.ts` already loads it if it exists on disk (via `store.exists(input)`)

**Fix approach -- override in ProductOwner/TechLead:**

For ProductOwner: override `run()` to catch the `constitution_project` field from parsed JSON and write it as a separate artifact.

```typescript
// src/agents/product-owner.ts
export class ProductOwnerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['prd.md'],
      manifest: 'prd.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    // Run normal LLMAgent flow
    await super.run(context);

    // Post-process: extract constitution_project from LLM response
    // We need access to the parsed response -- override the parent's parsing
  }
}
```

**Problem:** `LLMAgent.run()` parses JSON internally and discards unknown fields. Two options:

**Option A (recommended): Override `run()` entirely in ProductOwner/TechLead** -- duplicate the LLMAgent.run() logic but add constitution handling. ~40 lines per agent.

**Option B: Extend LLMAgent to support extra fields** -- Add a hook/callback in LLMAgent that subclasses can use to process extra JSON fields. Changes frozen module (LLMAgent).

**Recommendation: Option A** -- ProductOwner and TechLead override `run()`, call `this.provider.call()` directly with `jsonSchema`, parse the full JSON (including `constitution_project`), write the extra file. This keeps LLMAgent frozen and follows the "no over-engineering" constraint.

**TechLead specifics:** TechLead receives existing `constitution.project.md` as input, appends its `constitution_project_update` to it, and writes the updated version back.

### Output Format Alignment (AGENT-04)

**The contradiction:**
- UXDesigner prompt says: "Wrap each output using HTML comment delimiters" (`<!-- ARTIFACT:ux-flows.md -->`)
- APIDesigner prompt says the same HTML delimiter pattern
- Both agents extend `LLMAgent` which calls `provider.call()` with `jsonSchema` option
- With `jsonSchema`, the LLM is forced to return structured JSON, making the HTML delimiter instructions impossible to follow

**The fix:** Update prompts to match the JSON output format that LLMAgent actually enforces. All other LLMAgent subclasses (ProductOwner, Researcher, TechLead) already use the correct JSON format in their prompts.

**Changes needed:**
1. `.claude/agents/mosaic/ux-designer.md` -- Replace the HTML delimiter Output section with JSON format:
   ```json
   {
     "artifact": "...full ux-flows.md content...",
     "manifest": { "flows": [...], "components": [...], "interaction_rules": [...] }
   }
   ```
2. `.claude/agents/mosaic/api-designer.md` -- Same replacement
3. Remove the clarification HTML delimiter instructions (LLMAgent handles clarification via the `clarification` JSON field)

**This is clearly a prompt fix, not a code fix** -- the code (LLMAgent + jsonSchema) is the correct pattern used by 5+ other agents.

### Manifest Validation Hardening (AGENT-05)

**Current state analysis:**
- `manifest.ts:writeManifest()` already calls `schema.parse(data)` which throws on invalid data
- `MANIFEST_SCHEMAS` registry covers all 11 manifest types
- The validation is already active -- `schema.parse()` throws a ZodError if data doesn't match

**Potential gap:** If an agent calls `writeOutputManifest()` with a name not in `MANIFEST_SCHEMAS`, the write silently succeeds without validation (line 190-191: `if (schema) schema.parse(data)`).

**Fix:** Make the schema lookup throw when no schema is found for a known manifest name:
```typescript
export function writeManifest(store: ArtifactStore, name: string, data: unknown): void {
  const schema = MANIFEST_SCHEMAS[name];
  if (!schema && name.endsWith('.manifest.json')) {
    throw new Error(`No Zod schema registered for manifest: ${name}`);
  }
  if (schema) schema.parse(data);
  store.write(name, JSON.stringify(data, null, 2));
}
```

**Audit of manifest names vs schema registry:**

| Agent Output | Manifest Name | In MANIFEST_SCHEMAS? |
|-------------|---------------|---------------------|
| Researcher | research.manifest.json | Yes |
| ProductOwner | prd.manifest.json | Yes |
| UXDesigner | ux-flows.manifest.json | Yes |
| APIDesigner | api-spec.manifest.json | Yes |
| UIDesigner | components.manifest.json | Yes |
| TechLead | tech-spec.manifest.json | Yes |
| Coder | code.manifest.json | Yes |
| QALead | test-plan.manifest.json | Yes |
| Tester | test-report.manifest.json | Yes |
| SecurityAuditor | security-report.manifest.json | Yes |
| Reviewer | review.manifest.json | Yes |

All 11 manifests have schemas. The hardening is about making `writeManifest` fail-closed (throw on unregistered) rather than fail-open (silently skip validation).

### Hook Activation (AGENT-06)

**Current hook registration in `getHooksForStage()`:**

| Stage | PreRun Hooks | PostRun Hooks |
|-------|-------------|---------------|
| ALL | constitution-compliance-pre (warn) | constitution-compliance-post (warn) |
| product_owner | -- | traceability-check F-NNN (warn) |
| tech_lead | -- | traceability-check F-NNN+T-NNN (warn) |
| coder | -- | placeholder-check (warn), traceability-check T-NNN (warn) |
| ui_designer | -- | placeholder-check (warn) |
| ux_designer | -- | traceability-check F-NNN (warn) |
| api_designer | -- | traceability-check F-NNN (warn) |

**All hooks are `mandatory: false` (warn only).** None will block pipeline execution.

**Critical bug: `lastOutput` tracking.** `BaseAgent.execute()` passes `this.lastOutput` to post-run hooks (line 89). `lastOutput` is set in `writeOutput()` (line 118). But:
- `LLMAgent.run()` calls `this.writeOutput(artifactName, parsed.artifact)` which sets `lastOutput`
- Complex agents (Coder, UIDesigner) may call `writeOutput` multiple times -- `lastOutput` only captures the last one
- For ToolUseAgent, the `writeOutput` call sets it correctly

**This means hooks currently work correctly for simple agents** (LLMAgent subclasses) but may miss content for multi-output agents.

**Hook mandatory recommendations:**

| Hook | Recommended | Rationale |
|------|------------|-----------|
| constitution-compliance-pre | warn | Constitution may be absent in dev/test |
| constitution-compliance-post | warn | Edge cases with legitimate "Lorem ipsum" in research |
| placeholder-check | **mandatory for ui_designer**, warn for coder | UI stubs are unacceptable; coder may have TODO in internal code |
| traceability-check | warn | F-NNN coverage is important but not pipeline-blocking at this phase |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Manifest validation | Custom validation logic | Zod schemas already in manifest.ts | 11 schemas already defined and wired |
| Tool-use argument passing | Custom CLI arg builder | `LLMCallOptions.allowedTools` + existing provider `buildArgs()` | Both providers already support it |
| Constitution file I/O | Direct fs.writeFileSync | `this.writeOutput('constitution.project.md', content)` via BaseAgent | Consistent with artifact isolation, triggers events |

## Common Pitfalls

### Pitfall 1: ToolUseAgent + jsonSchema Conflict
**What goes wrong:** If both `allowedTools` and `jsonSchema` are passed to `provider.call()`, ClaudeCLI sends both `--allowedTools` and `--json-schema` flags. Claude CLI may not handle both simultaneously well.
**Why it happens:** Easy to accidentally copy from LLMAgent pattern.
**How to avoid:** ToolUseAgent must NEVER pass `jsonSchema` to provider. Use only `allowedTools`.
**Warning signs:** LLM returns structured_output instead of using tools.

### Pitfall 2: Constitution Not Written Before Downstream Reads
**What goes wrong:** `context-manager.ts` tries to load `constitution.project.md` for downstream agents but it doesn't exist yet.
**Why it happens:** ProductOwner's LLMAgent.run() currently drops the `constitution_project` field silently.
**How to avoid:** Verify `constitution.project.md` exists on disk after ProductOwner completes.
**Warning signs:** `context:constitution-missing` warning in logs.

### Pitfall 3: Researcher Manifest Parsing from Free Text
**What goes wrong:** ToolUseAgent produces free text. Extracting structured manifest data from free text is fragile.
**Why it happens:** No schema enforcement on tool-use responses.
**How to avoid:** Researcher prompt should instruct LLM to include a clearly delimited JSON manifest block. Use defensive parsing with fallback defaults.
**Warning signs:** Manifest write fails with ZodError.

### Pitfall 4: Post-Run Hooks See Empty Output
**What goes wrong:** `lastOutput` is empty string if agent doesn't call `writeOutput()`.
**Why it happens:** `BaseAgent.lastOutput` defaults to `''` and is only set via `writeOutput()`.
**How to avoid:** Ensure ToolUseAgent always calls `writeOutput()` before hooks fire.
**Warning signs:** All post-run hooks pass trivially (empty string matches nothing).

### Pitfall 5: UXDesigner/APIDesigner Prompt Still Has HTML Delimiters
**What goes wrong:** After prompt update, if any residual HTML delimiter instructions remain, the LLM may produce malformed JSON.
**Why it happens:** Incomplete prompt edit.
**How to avoid:** Full search-and-replace in both prompt files. Test with actual LLM call.
**Warning signs:** `llm:json-parse-fallback` warning in logs.

## Code Examples

### ToolUseAgent Base Class
```typescript
// Source: Pattern extracted from src/agents/qa-lead.ts (lines 85-89)
// and src/agents/coder/coder-builder.ts (lines 71-76)
const response = await this.provider.call(prompt, {
  systemPrompt: context.systemPrompt,
  allowedTools: context.task.autonomy?.allowed_tools ?? [],
  maxBudgetUsd: context.task.autonomy?.max_budget_usd,
  timeoutMs: 600_000,
});
```

### Constitution Persistence in ProductOwner
```typescript
// Parse extra field from LLM JSON response
const parsed = JSON.parse(raw) as {
  artifact?: string;
  manifest?: unknown;
  constitution_project?: string;
};

// Write constitution if present
if (parsed.constitution_project) {
  this.writeOutput('constitution.project.md', parsed.constitution_project);
}
```

### Prompt Fix Pattern (UXDesigner/APIDesigner)
```markdown
## Output

Your response must be a JSON object with these fields:

{
  "artifact": "...full ux-flows.md content...",
  "manifest": {
    "flows": [...],
    "components": [...],
    "interaction_rules": [...]
  },
  "clarification": "...question if you need more info, otherwise omit or leave empty..."
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGENT-01 | ToolUseAgent calls provider with allowedTools, no jsonSchema | unit | `npx vitest run src/agents/__tests__/tool-use-agent.test.ts -x` | Wave 0 |
| AGENT-02 | Researcher extends ToolUseAgent, uses WebSearch/WebFetch tools | unit | `npx vitest run src/agents/__tests__/researcher.test.ts -x` | Wave 0 |
| AGENT-03 | ProductOwner writes constitution.project.md to disk | unit | `npx vitest run src/agents/__tests__/product-owner.test.ts -x` | Wave 0 |
| AGENT-03 | TechLead appends to constitution.project.md | unit | `npx vitest run src/agents/__tests__/tech-lead.test.ts -x` | Wave 0 |
| AGENT-04 | UXDesigner/APIDesigner prompt matches LLMAgent JSON format | manual-only | Visual review of prompt files | N/A |
| AGENT-05 | writeManifest throws on unregistered manifest name | unit | `npx vitest run src/core/__tests__/manifest.test.ts -x` | Exists (extend) |
| AGENT-06 | Post-run hooks fire and check output correctly | unit | `npx vitest run src/core/__tests__/hooks.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/agents/__tests__/tool-use-agent.test.ts` -- covers AGENT-01 (ToolUseAgent base class)
- [ ] `src/agents/__tests__/researcher.test.ts` -- covers AGENT-02 (Researcher as ToolUseAgent)
- [ ] `src/agents/__tests__/product-owner.test.ts` -- covers AGENT-03 (constitution persistence)
- [ ] `src/agents/__tests__/tech-lead.test.ts` -- covers AGENT-03 (constitution append)
- [ ] `src/core/__tests__/hooks.test.ts` -- covers AGENT-06 (hook activation and output check)

Existing `src/core/__tests__/manifest.test.ts` covers AGENT-05 (extend with unregistered name test).

## Sources

### Primary (HIGH confidence)
- Direct codebase reading: `src/agents/llm-agent.ts`, `src/core/agent.ts`, `src/core/manifest.ts`, `src/core/hooks/index.ts`, `src/core/stage-executor.ts`
- Prompt files: `.claude/agents/mosaic/ux-designer.md`, `.claude/agents/mosaic/api-designer.md`, `.claude/agents/mosaic/product-owner.md`, `.claude/agents/mosaic/tech-lead.md`
- Config: `config/agents.yaml`
- Pattern reference: `src/agents/qa-lead.ts`, `src/agents/coder/coder-builder.ts`

### Secondary (MEDIUM confidence)
- None needed -- all findings from direct code analysis

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing modules, no new dependencies
- Architecture: HIGH -- patterns already proven in QALead/CoderBuilder, extracting into base class
- Pitfalls: HIGH -- identified from direct code reading of actual failure paths

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable codebase, no external dependencies)
