# Stack Research: v1.1 Quality & Cost Optimization

**Domain:** AI multi-agent pipeline quality gates, LLM cost tracking, intelligent error classification
**Researched:** 2026-03-28
**Confidence:** HIGH (verified against official Anthropic docs, existing codebase patterns)

## Key Finding: No New Dependencies Needed

All five v1.1 capabilities can be built with the existing stack plus capabilities already available in `@anthropic-ai/sdk ^0.78.0`. Zero new `npm install` required.

---

## Recommended Stack Additions

### 1. Manifest Content Validation — Zod Refinements (existing `zod ^4.3.6`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Zod `.refine()` / `.superRefine()` | ^4.3.6 (existing) | Semantic validation beyond schema shape | Already in the stack. Refinements add content-level checks (e.g., "files array must reference existing disk paths", "covers_features must be non-empty") without a new dependency. |

**Integration point:** `src/core/manifest.ts` — extend existing schemas with `.refine()` checks.

**What to build (not install):**
- Add `.refine()` validators to `CodeManifestSchema`: files exist on disk, no placeholder markers (`TODO`, `PLACEHOLDER`, `// stub`)
- Add `.refine()` validators to `TestReportManifestSchema`: failure messages are non-empty, total >= passed + failed + skipped
- Add `.refine()` validators to `ComponentsManifestSchema`: component files exist, covers_features non-empty
- Create a `validateManifestContent(store, name, data)` function that runs Zod schema + disk existence checks
- Wire into `StageExecutor` post-agent-execution, before gate check

**Why NOT a separate validation library:**
Zod refinements are composable and co-located with schema definitions. Adding a separate validation framework (e.g., Joi, class-validator) would split validation logic across two systems. The existing Zod-everywhere pattern is correct.

### 2. LLM Token Cost Tracking — Anthropic SDK `usage` field (existing `@anthropic-ai/sdk ^0.78.0`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@anthropic-ai/sdk` usage response field | ^0.78.0 (existing) | Per-call token counting from API response | Already returns `usage.input_tokens` and `usage.output_tokens` on every `messages.create()` response. AnthropicSDKProvider already extracts this. |
| `@anthropic-ai/sdk` `messages.countTokens()` | ^0.78.0 (existing) | Pre-call token estimation | Available via `client.messages.countTokens()`. Accepts same message/tool params. Use for budget checks before expensive calls. |

**Integration points:**
- `LLMResponse.usage` — already defined with `inputTokens` and `outputTokens`
- `AnthropicSDKProvider` — already populates `usage` from response (lines 62-73)
- `ClaudeCLIProvider` — does NOT populate usage (CLI JSON output doesn't expose token counts reliably)

**What to build (not install):**
- Add a `CostTracker` class that accumulates `LLMResponse.usage` per stage per run
- Emit `stage:cost` events on EventBus with `{ stage, inputTokens, outputTokens, estimatedCostUsd }` payload
- Store per-run cost summary in `run-metadata.json` alongside `pipeline-state.json`
- Add cost-per-model lookup table (static pricing data, not an API call)
- Optionally use `messages.countTokens()` for pre-flight budget checks on expensive stages (UIDesigner, Coder)

**Cost model data (hardcoded, no API):**

| Model | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|---------------------|----------------------|
| claude-sonnet-4 | $3.00 | $15.00 |
| claude-opus-4 | $15.00 | $75.00 |
| claude-haiku-3.5 | $0.80 | $4.00 |

**Why NOT tiktoken or external token counters:**
The Anthropic SDK's built-in `messages.countTokens()` is the only accurate method for Claude models. Third-party tokenizers (tiktoken, anthropic-tokenizer-typescript) use approximations that diverge from actual billing. Post-call `usage` is free and exact.

**Why NOT pipeline-level budget enforcement:**
PROJECT.md explicitly lists "Pipeline 级费用控制" as out of scope. Track and report costs, don't enforce budgets.

### 3. Intelligent Error Classification — Enhanced `retry-log.ts` (no new deps)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Enhanced `classifyError()` | existing code | Root cause diagnosis for fix loop | Current `classifyError()` in `src/core/retry-log.ts` already has 8 categories. Extend with test-specific subcategories. |

**Integration point:** `src/core/retry-log.ts`, `src/core/fix-loop-runner.ts`

**What to build (not install):**
- Extend `ErrorCategory` type with test-specific subcategories: `'test-config-error'`, `'test-import-error'`, `'test-assertion-error'`, `'test-runtime-error'`
- Add pattern matching for common root causes the current classifier misses:
  - `.ts`/`.tsx` extension in test imports → `'test-config-error'` (the v1.0 run-1774640936546 failure root cause)
  - Missing test setup/teardown → `'test-config-error'`
  - `Cannot find module` in test context → `'test-import-error'`
  - `expect(...).toBe(...)` assertion failures → `'test-assertion-error'`
- Add `suggestFix(category: ErrorCategory): string` that returns actionable guidance for each category
- Feed classification + suggestion into fix loop context so Coder gets structured diagnosis, not raw error dumps
- Add `isInfrastructureError(category)` helper — infrastructure errors (config, import) should trigger different fix strategies than logic errors (assertion)

**Why NOT an ML-based classifier:**
The error space is bounded (TypeScript compilation, Vitest test execution, ESM module resolution). Regex patterns match 95%+ of cases. An ML classifier would add latency, cost, and a dependency for marginal improvement.

### 4. Web Research for Intent Consultant — Anthropic SDK `web_search` Server Tool (existing `@anthropic-ai/sdk ^0.78.0`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Anthropic `web_search_20250305` server tool | API-level (no SDK version bump) | Real-time web research during intent analysis | Server-side tool — Anthropic executes the search, returns results with citations. No client-side infrastructure needed. $10/1000 searches. |

**Integration point:** `src/providers/anthropic-sdk.ts`, `src/agents/intent-consultant.ts` (or a new Researcher agent enhancement)

**How it works:**
```typescript
// Add to tools array in AnthropicSDKProvider when web search is requested
params.tools.push({
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,  // cap searches per call
});
```

**What to build (not install):**
- Add `webSearch?: boolean | WebSearchConfig` to `LLMCallOptions` interface
- In `AnthropicSDKProvider.call()`, when `options.webSearch` is truthy, add the `web_search_20250305` tool to `params.tools`
- Handle `server_tool_use` and `web_search_tool_result` content blocks in response parsing
- Extract citations from response for inclusion in research artifact
- For Claude CLI provider: use `--allowedTools WebSearch` flag (already supported via `allowedTools` option)
- Add `webSearch: true` to Researcher agent config in `config/agents.yaml`

**Configuration options for WebSearchConfig:**
```typescript
interface WebSearchConfig {
  maxUses?: number;           // default 5
  allowedDomains?: string[];  // domain whitelist
  blockedDomains?: string[];  // domain blacklist
}
```

**Why NOT a separate search API (Brave, Tavily, SerpAPI):**
- Anthropic's server-side web search is zero-infrastructure: no API keys to manage, no rate limiting to implement, no search result parsing
- Results are pre-integrated into Claude's context with citations
- Cost is comparable ($10/1000 vs Brave's $3-5/1000) but eliminates all integration complexity
- The search runs server-side in the same API call, no additional latency from client-side tool loops

**Why NOT the newer `web_search_20260209` with dynamic filtering:**
- Requires the code execution tool to be enabled, which adds complexity
- The base `web_search_20250305` is sufficient for intent research (not doing large-scale literature review)
- Can upgrade later if needed — it's a one-line tool type change

### 5. UI Component Generation Cost Reduction — Prompt Engineering + Batching (no new deps)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Existing batching in `UIDesignerAgent` | current code | Reduce LLM calls by batching components | Already implemented with `MAX_BATCH_SIZE = 6`. Optimization is about smarter batching and prompt trimming, not new libraries. |
| `ui-api-trimmer.ts` | current code | Trim API spec per component category | Already implements layered injection (atomic=none, composite=schemas, page=endpoints). Further trimming is prompt engineering. |

**What to build (not install):**
- **Selective screenshot rendering**: Skip Playwright screenshots for atomic components (buttons, inputs). Only render composite and page previews. This alone could eliminate 40-60% of Playwright calls.
- **Component deduplication in planner**: Add a dedup pass that merges similar atomic components (e.g., `PrimaryButton`, `SecondaryButton`, `DangerButton` → single `Button` with variant prop)
- **Cached design tokens**: Extract design tokens once and cache, don't re-serialize per component
- **Batch size tuning**: Current `MAX_BATCH_SIZE = 6` may be suboptimal. Add configuration to `config/pipeline.yaml` for per-category batch sizes
- **Preview HTML simplification**: Current previews are full HTML documents. Use a minimal wrapper template to reduce output tokens

**Why NOT a template/codegen approach (Shadcn, Storybook automation):**
The UIDesigner produces bespoke components matching the PRD, not generic UI kit components. Template libraries would constrain the design space. The correct optimization is fewer, smarter LLM calls — not replacing LLM generation.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Zod `.refine()` for manifest validation | JSON Schema + ajv | If validation needs to run outside Node.js (e.g., browser, other language). Not our case. |
| Anthropic SDK `usage` for cost tracking | LangSmith / Helicone / Portkey | If you need a hosted observability dashboard with team access. Overkill for single-developer pipeline. |
| Enhanced regex `classifyError()` | LLM-based error classification | If error patterns become too diverse for regex. Currently bounded — revisit after v1.1 data. |
| Anthropic `web_search` server tool | Brave Search API + custom integration | If you need search independent of LLM provider, or need guaranteed deterministic search results. |
| Prompt engineering for UI cost | Smaller model for atomic components | If cost remains high after prompt optimization. Could route atomic components to Haiku. |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `tiktoken` | Inaccurate for Claude models. Anthropic's tokenizer is proprietary. | `@anthropic-ai/sdk` `messages.countTokens()` or post-call `usage` |
| `langchain` / `langsmith` | Massive dependency tree, abstractions conflict with existing agent architecture | Built-in `CostTracker` class + EventBus emissions |
| `ajv` / `joi` for validation | Splits validation across two schema systems (Zod + another) | Zod refinements keep everything in one system |
| External search API SDKs | Additional API keys, rate limiting, response parsing | Anthropic server-side `web_search` tool |
| `anthropic-tokenizer-typescript` | Offline tokenizer — but approximation only, not billing-accurate | `messages.countTokens()` for pre-call, `usage` for post-call |
| Template UI libraries (Shadcn codegen) | Constrains LLM design freedom, doesn't match the product vision | Smarter batching + prompt trimming |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@anthropic-ai/sdk ^0.78.0` | `web_search_20250305` tool type | Server tool — no SDK update needed, just pass correct tool type in API params |
| `@anthropic-ai/sdk ^0.78.0` | `messages.countTokens()` | Available since SDK v0.25+. Already in our version range. |
| `zod ^4.3.6` | `.refine()` / `.superRefine()` | Available since Zod v3. Fully supported in v4. |

## Installation

```bash
# No new packages to install.
# All capabilities are available in existing dependencies.
```

## Sources

- [Anthropic Web Search Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) — verified tool type `web_search_20250305`, TypeScript integration, pricing ($10/1000 searches) — HIGH confidence
- [Anthropic Count Tokens API](https://platform.claude.com/docs/en/api/typescript/messages/count_tokens) — verified `client.messages.countTokens()` availability in TypeScript SDK — HIGH confidence
- Existing codebase: `src/core/manifest.ts`, `src/core/retry-log.ts`, `src/providers/anthropic-sdk.ts`, `src/agents/ui-designer.ts` — direct code analysis — HIGH confidence
- [Anthropic Web Search Announcement](https://www.anthropic.com/news/web-search-api) — pricing and availability confirmation — HIGH confidence

---
*Stack research for: Mosaicat v1.1 Quality & Cost Optimization*
*Researched: 2026-03-28*
