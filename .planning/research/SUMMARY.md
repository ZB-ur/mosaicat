# Project Research Summary

**Project:** Mosaicat v1.1 — Quality & Cost Optimization
**Domain:** Multi-agent LLM pipeline quality gates, cost tracking, and intelligent error classification
**Researched:** 2026-03-28
**Confidence:** HIGH

## Executive Summary

Mosaicat v1.0 completed its first full pipeline run (run-1774640936546) and exposed three classes of critical failure: manifest self-reporting lies (45% actual coverage vs 100% claimed), futile fix loop rounds (5 rounds, 24% of run time wasted because parse errors and assertion errors were treated identically), and excessive UI generation cost (39 min, 30% of run time for screenshots that provided no downstream value). The v1.1 initiative is a targeted surgical upgrade — not a rewrite — to make the existing pipeline reliable and cost-efficient. All needed capabilities already exist in the current dependency set; zero new packages are required.

The recommended approach is a layered build: foundation components first (token tracking, placeholder detection, error classification as pure independently-testable modules), then the quality gate that composes them, then integration into the pipeline executor. This mirrors the architecture's existing decorator and strategy patterns and avoids coupling new behavior to live pipeline flow until it is tested in isolation. The critical architectural constraint: quality gates must be deterministic mechanical checks, never LLM calls. LLM-based quality assessment already exists in the Reviewer and Validator agents — adding it to intermediate gates creates feedback loops and doubles cost with no reliability gain.

The primary risk is over-engineering. Each individual quality check is justified in isolation, but cumulative validation overhead must stay under 15% of pipeline duration (currently ~130 min total). The second risk is implementing stub detection via keyword matching alone — the v1.0 run's 13 placeholder components used `<div>ComponentName</div>` patterns that no keyword list catches. Detection must combine structural validation (AST node count, export presence, import resolution) with keyword scanning, not keyword scanning alone.

## Key Findings

### Recommended Stack

All five v1.1 capabilities build on the existing stack. No `npm install` needed. The `@anthropic-ai/sdk ^0.78.0` already exposes `usage.input_tokens`/`output_tokens` on every response (AnthropicSDKProvider already populates `LLMResponse.usage` but nothing consumes it). `zod ^4.3.6` supports `.refine()` and `.superRefine()` for semantic validation beyond schema shape. The existing `classifyError()` in `retry-log.ts` has 9 categories and pure regex — it only needs its return type extended and stage-aware routing added.

**Core technologies (existing, leveraged for v1.1):**
- `zod ^4.3.6`: Manifest semantic validation via `.refine()` — co-located with existing schemas, no split validation systems
- `@anthropic-ai/sdk ^0.78.0` usage field: Post-call exact token counts — more accurate than any third-party tokenizer for Claude models
- `@anthropic-ai/sdk ^0.78.0` `messages.countTokens()`: Pre-call estimation for budget-aware stages (Coder, UIDesigner)
- Enhanced `classifyError()` in `retry-log.ts`: Extended return type with `suggestedAction` — no new library needed
- `web_search_20250305` server tool (Anthropic API-level): Zero-infrastructure web search for Researcher — runs server-side, returns citations, no API key management

**What NOT to add:**
- `tiktoken` or `anthropic-tokenizer-typescript` — approximations only; SDK `usage` is exact and free
- `langchain`/`langsmith` — dependency tree conflicts with agent architecture; built-in EventBus handles observability
- `ajv`/`joi` — splits validation across two schema systems; Zod refinements keep everything in one place
- Template UI libraries (Shadcn, Storybook automation) — constrains LLM design freedom; smarter batching is the right optimization

### Expected Features

The v1.0 run data provides a concrete prioritization signal: every P1 feature addresses a documented failure from run-1774640936546.

**Must have — v1.1 (P1, addresses known critical failures):**
- Stub/placeholder detection — eliminates the #1 quality problem (13 fake components claimed as real)
- Test file validity pre-check (`tsc --noEmit`) — catches infrastructure errors before fix loop starts
- Fix loop stagnation detection — aborts after 2 rounds with identical failure sets (would have saved 24% of v1.0 run time)
- Error category distinction: infrastructure vs logic — prevents futile fix loop rounds on parse errors
- Manifest stub-vs-real distinction (`implementation_status` enum per file) — makes `code.manifest.json` trustworthy
- Validator content spot-checking (sample N files programmatically) — catches manifest lies at final gate

**Should have — v1.2 (P2, efficiency gains once quality baseline is solid):**
- Cumulative cost tracking per stage — required baseline before any cost optimization
- UI Designer token budget control — after cost tracking confirms UIDesigner dominates
- Cross-stage artifact dependency validation — if feature gaps still reach Validator despite v1.1
- Prompt caching for shared context — after cost tracking identifies shared context as dominant cost driver

**Defer — v2+ (P3, high complexity, needs more production data):**
- Intelligent root cause diagnosis in fix loop — needs multi-run data to tune strategy mapping
- Researcher web search integration — large scope: API key management, result parsing, rate limiting; independent project

### Architecture Approach

V1.1 adds 5 new modules and modifies 6 existing ones, all following established patterns in the codebase. New modules are pure and independently testable before any pipeline integration. The QualityGate composes PlaceholderDetector and ManifestContentValidator, then runs as a synchronous check between `agent.execute()` and the existing gate check in StageExecutor — no new StageOutcome variant needed, quality failures reuse the existing `retry` path with violation details injected into ArtifactStore. TokenTrackingProvider wraps RetryingProvider (outside, not inside) so retried calls are counted — this follows the existing decorator pattern in `retrying-provider.ts`.

**Major new components:**
1. `QualityGate` (`src/core/quality-gate.ts`) — post-agent content validator; pure deterministic checks, no LLM; composes ManifestContentValidator + PlaceholderDetector + per-stage rules
2. `TokenTracker + TokenTrackingProvider` (`src/core/token-tracker.ts`) — accumulates `LLMResponse.usage` per stage; wraps provider chain as decorator; emits `token:usage` events; writes `token-usage.json` at run end
3. `PlaceholderDetector` (`src/core/placeholder-detector.ts`) — pure function `(content, fileType) => PlaceholderMatch[]`; reusable by both QualityGate and Validator
4. `ManifestContentValidator` (`src/core/manifest-validator.ts`) — cross-references manifest claims against disk reality; separate from `manifest.ts` (schema structure vs semantic truth)
5. `StageMetrics` (`src/core/stage-metrics.ts`) — per-stage timing + token usage + quality results; written as `stage-metrics.json` at run end

**Modified existing components:**
- `retry-log.ts`: Extend `classifyError()` to `classifyErrorDetailed()` returning `ClassifiedError { category, rootCause, suggestedAction, affectedFiles }`
- `StageExecutor`: Add `QualityGate` injection, call after executeAgent, inject violations into store on failure
- `FixLoopRunner`: Use `classifyErrorDetailed()` instead of round-number heuristic for approach selection
- `RunContext`: Add `readonly tokenTracker: TokenTracker` (one field addition)
- `EventBus`: Add `token:usage`, `quality:violation`, `quality:passed` events
- `Orchestrator`: Create tracker/gate in `initRunContext()`, write reports in `postRun()`

### Critical Pitfalls

1. **Gameable heuristic quality gates** — Keyword-based stub detection (`PLACEHOLDER_KEYWORDS`) fails as the LLM generates slightly different placeholders that bypass the list. Avoid: combine structural validation (AST node count, export presence, minimum JSX nodes) with keyword scanning; verify the gate rejects the actual 13 v1.0 placeholder components in tests before deployment.

2. **Self-reported manifest as authoritative source** — LLM lists what it was *asked* to build, not what it *actually* built. The v1.0 run claimed 100% coverage, actual was 45%. Avoid: programmatic manifest generation by scanning disk artifacts; move verification from Validator (stage 13, too late) to immediately post-Coder (fail fast).

3. **Error classification complexity without routing** — The existing `classifyError()` has 9 categories but the fix loop treats all identically. More categories add logs, not better behavior. Avoid: focus on the binary — "is this error in code the Coder controls, or in infrastructure/config?" Infrastructure errors → abort fix loop immediately; code errors → continue fixing.

4. **Wrong UI cost optimization target** — Capping component count reduces decomposition quality and degrades Coder output. Avoid: target screenshots (pure Playwright overhead — page-level only, skip atomic components; eliminates 40-60% of Playwright time) and batch generation. Never cap component count.

5. **Validation cascade overhead** — Each quality check is justified in isolation; together they can add 15-30 minutes to a 130-minute pipeline run. Avoid: enforce a 15% overhead budget; prefer early fast checks over late comprehensive ones; all gate checks must be programmatic (milliseconds, no LLM calls).

## Implications for Roadmap

Based on combined research, the ARCHITECTURE.md build order maps cleanly to 4 phases. Phase ordering follows two constraints: (1) new modules must be unit-testable before integration into live pipeline, (2) cost tracking must precede cost optimization.

### Phase 1: Foundation Modules
**Rationale:** These 4 items have zero cross-dependencies and can be built and tested in isolation. No pipeline integration required. Getting them right in isolation prevents bugs from compounding in later integration phases.
**Delivers:** `TokenTracker`, `PlaceholderDetector`, `classifyErrorDetailed()` extension in `retry-log.ts`, `StageMetrics` types — all fully tested, zero pipeline impact
**Addresses:** Establishes the building blocks for all P1 features (stub detection, error categorization, cost tracking)
**Avoids:** Pitfall 6 (validation cascade) — foundation components are pure functions with millisecond execution time

### Phase 2: Quality Gate
**Rationale:** Depends only on PlaceholderDetector from Phase 1 and the existing ArtifactStore interface. Can be built and validated against v1.0 artifacts before touching StageExecutor.
**Delivers:** `ManifestContentValidator`, `QualityGate` — verified against real v1.0 failure artifacts (must reject the 13 placeholder components and catch the `.tsx`/`.ts` test extension bug)
**Addresses:** P1 features: stub/placeholder detection, manifest stub-vs-real distinction, test file validity pre-check, Validator content spot-checking
**Avoids:** Pitfall 1 (gameable heuristics) — gate tested against known-bad output before deployment; Pitfall 2 (self-reported manifest)

### Phase 3: Pipeline Integration
**Rationale:** Pure components are proven in isolation. Now wire into StageExecutor, FixLoopRunner, Orchestrator. This is the highest-risk phase (modifies live pipeline flow) but risk is bounded because the components it integrates are already tested.
**Delivers:** Quality gate active in pipeline, token tracking live, error-aware fix loop approach selection, `token-usage.json` and `stage-metrics.json` artifacts written on every run
**Addresses:** P1 features: error category distinction in Tester, fix loop stagnation detection; P2 features: cumulative cost tracking
**Avoids:** Pitfall 3 (classification without routing) — `suggestedAction` field drives fix loop strategy; Pitfall 6 (validation overhead) — pipeline duration monitored before/after

### Phase 4: UI Cost Optimization
**Rationale:** Depends on Phase 3 cost tracking to confirm UIDesigner is the dominant cost driver and establish the baseline. Pitfall 4 warns that optimizing the wrong target (component count) destroys quality.
**Delivers:** Selective screenshot rendering (page-level only), component deduplication in planner, batch size configuration in `config/pipeline.yaml`
**Addresses:** P2 feature: UI Designer token budget control
**Avoids:** Pitfall 4 (wrong optimization target) — token/time measurements from Phase 3 guide what to cut

### Phase Ordering Rationale

- Phase 1 before Phase 2: QualityGate composes PlaceholderDetector; build the parts before the composite
- Phase 2 before Phase 3: Gate logic needs isolated testing against v1.0 artifacts before it can block real pipeline stages
- Phase 3 before Phase 4: Can't measure cost optimization ROI without tracking baseline from Phase 3
- Intent enrichment (Researcher web search) deferred beyond this roadmap: Pitfall 5 warns it must come AFTER downstream quality gates are in place so you can measure whether enrichment actually changes gate pass rates

### Research Flags

Phases with well-documented patterns (standard implementation, skip research-phase):
- **Phase 1:** All four modules are pure functions or decorator extensions of existing code — established patterns, direct implementation
- **Phase 2:** QualityGate follows StageExecutor's existing check pattern; ManifestContentValidator follows existing `manifest.ts` structure; both can be tested against real v1.0 artifacts

Phases that may need targeted research during planning:
- **Phase 3 (FixLoopRunner stagnation detection):** Error signature normalization — comparing failures across rounds without matching on line numbers requires a concrete normalization strategy before implementation (compare on file + error category tuples, not raw error strings)
- **Phase 4 (UI cost optimization):** Selective Playwright rendering for page-level components only — need to verify which UIDesigner component categories map to pages vs atomics in the current `UIPlanSchema` output format

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against Anthropic SDK docs and existing codebase. Zero new dependencies. All integration points identified with file/line references. |
| Features | HIGH | Grounded in real run-1774640936546 failure data. Priorities derived from measured impact (minutes wasted, coverage gap percentage). |
| Architecture | HIGH | Based on direct analysis of shipped v1.0 modules with exact line counts. New component interfaces fully specified with TypeScript types. Build order has clear dependency rationale. |
| Pitfalls | HIGH | Derived from v1.0 run analysis and codebase review. Each pitfall has concrete evidence (not hypothetical) and specific warning signs for early detection. |

**Overall confidence:** HIGH

### Gaps to Address

- **Stagnation detection normalization strategy:** How to compare "same failures" across fix loop rounds when error messages include line numbers that shift between rounds. Proposed approach: compare on `(file path, error category)` tuples, not raw error strings — needs validation against real fix loop logs from the v1.0 run.
- **Manifest backward compatibility:** `CodeManifestSchema` will gain `implementation_status` per file. Existing manifests written in old format must be handled gracefully by `readManifest()`. Resolution during Phase 2 planning: add Zod `.optional().default('unknown')` to all new fields.
- **Quality gate threshold calibration:** At what stub-density does a stage fail vs warn? Proposed: fail if >20% of code files are pure stubs; warn otherwise. Validate against v1.0 artifacts before shipping Phase 2.

## Sources

### Primary (HIGH confidence)
- `.planning/debug/run-analysis-1774640936546.md` — Real v1.0 production failure data: 13 placeholder components, 14/16 test files unparseable, 5 futile fix loop rounds, 24% run time wasted
- [Anthropic Web Search Tool Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) — verified `web_search_20250305` TypeScript integration and pricing ($10/1000 searches)
- [Anthropic Count Tokens API](https://platform.claude.com/docs/en/api/typescript/messages/count_tokens) — verified `client.messages.countTokens()` availability
- Direct codebase analysis: `src/core/stage-executor.ts` (207 lines), `src/core/fix-loop-runner.ts` (130 lines), `src/core/retry-log.ts` (173 lines), `src/core/manifest.ts` (329 lines), `src/core/llm-provider.ts` (38 lines), `src/agents/ui-designer.ts`, `src/core/retrying-provider.ts` (165 lines)

### Secondary (MEDIUM confidence)
- [Agentic Engineering: Dual Quality Gates](https://www.sagarmandal.com/2026/03/15/agentic-engineering-part-7-dual-quality-gates-why-validation-and-testing-must-be-separate-processes/) — Separation of validation and testing as distinct pipeline processes
- [Why AI Agents Break: Production Failures](https://arize.com/blog/common-ai-agent-failures/) — Error propagation patterns in production agents
- [7 AI Agent Failure Modes](https://galileo.ai/blog/agent-failure-modes-guide) — Fix loop anti-patterns, ensemble verification tradeoffs
- [Detecting Hallucinations via AST Analysis](https://arxiv.org/html/2601.19106v1) — AST vs regex tradeoffs; deterministic analysis catches 77% of code hallucinations
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) — LoopAgent quality gate patterns

### Tertiary (for context)
- [LLM Token Optimization](https://redis.io/blog/llm-token-optimization-speed-up-apps/) — Prompt caching (90% reduction on cached prefixes), context compression strategies
- [Agents At Work: 2026 Playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) — Production reliability patterns for agentic workflows
- [Characterizing Faults in Agentic AI](https://arxiv.org/html/2603.06847v1) — Taxonomy of fault types and root causes in agent systems

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
