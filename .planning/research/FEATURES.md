# Feature Research

**Domain:** Quality gates, cost optimization, and intelligent diagnostics for multi-agent LLM pipelines
**Researched:** 2026-03-28
**Confidence:** HIGH (grounded in real run data from run-1774640936546 + industry patterns)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any mature multi-agent pipeline must have. Missing these = pipeline produces unreliable output silently. All grounded in concrete failures observed in the v1.0 production run.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Stub/placeholder detection in Coder output** | v1.0 run: 13 placeholder `<div>ComponentName</div>` components passed validation. Manifest claimed 100% coverage, actual ~45%. Users expect "done" to mean "implemented". | MEDIUM | Programmatic post-Coder scan: regex for bare `<div>Name</div>`, empty function bodies, `TODO`/`FIXME`, hardcoded `return null`. Run pre-manifest-write. No LLM needed. Existing `OutputGenerator.generateManifest()` is the injection point. |
| **Error category distinction in Tester** | 14/16 test files failed at parse/import time (TSX config issue), not assertion time. Fix loop ran 5 futile rounds (~31 min, 24% of total) because it couldn't distinguish infrastructure from logic bugs. | MEDIUM | Classify test failures into: (1) parse/import errors, (2) assertion failures, (3) runtime errors. Parse errors flagged as "test infrastructure" so Coder fixes config, not code. Extend existing `classifyError()` in `retry-log.ts`. Tester agent needs structured output parsing of vitest JSON reporter. |
| **Fix loop stagnation detection** | Rounds 2-5 had identical failure sets as Round 1. Zero progress for 4 rounds. `FixLoopRunner` doesn't compare failure fingerprints between rounds. | LOW | Hash failure sets per round. If 2 consecutive rounds produce identical hashes, abort early with stagnation report. ~20 lines in `fix-loop-runner.ts`. Simple set comparison on `test-report.manifest.json` failures array. |
| **Manifest stub-vs-real distinction** | `CodeManifestSchema` lists files with `path`/`module`/`description` but no implementation status. LLM self-reports coverage unverifiably. The v1.0 run claimed `covers_tasks: ["T-001"..."T-029"]` with 45% actual. | MEDIUM | Add `implementation_status: 'stub' \| 'partial' \| 'complete'` per file in `CodeManifestSchema`. Populate via programmatic checks (file size threshold, export count, function body heuristics). Zod schema change + validation logic in `OutputGenerator`. |
| **Validator content spot-checking** | Current Validator reads manifests only (~3k tokens) -- never opens actual artifacts. Manifest claiming 100% coverage with actual 45% passes validation. `checkFileIntegrity()` checks existence, not content. | MEDIUM | Validator samples N files (e.g., 3 code files, 2 components) and does lightweight content checks: non-empty exports, no placeholder patterns, matches manifest description. Add programmatic checks alongside existing Check 5-8. Hybrid: deterministic checks first, optional LLM for subjective assessment. |
| **Test file validity pre-check** | Test files with syntax/import errors waste entire fix loop rounds. 14 test files couldn't parse JSX -- a `tsc --noEmit` would have caught this in seconds before running vitest. | LOW | Run compilation check on test files before `vitest run` in Tester agent. If compilation fails, report as "infrastructure error" with specific fix guidance (e.g., "add JSX transform to vitest config"). Prevents fix loop from even starting for infra issues. |

### Differentiators (Competitive Advantage)

Features that elevate pipeline reliability beyond basic "it runs". Not expected by default, but high value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Intelligent root cause diagnosis in fix loop** | Current progressive strategy (direct-fix -> replan -> full-history) doesn't adapt to error type. Parse errors get same treatment as assertion failures. An error analyzer would select targeted fix approach per category. | HIGH | Build on `classifyError()` foundation. Map categories to strategies: parse errors -> fix tsconfig/vite config; assertion errors -> fix code logic; import errors -> fix dependencies/paths. Requires changes to `FixLoopRunner.selectApproach()` and `CoderBuilder.implementModuleWithErrors()`. |
| **UI Designer token budget control** | UI Designer consumed 39 min (30% of run time) generating 73 components. Many decorative variants, animations, charts may not need full implementation. Smart prioritization could cut 40-60%. | MEDIUM | Planner phase scores components by functional importance (P0: core pages, P1: interactive widgets, P2: decorative/animation). Only P0+P1 get full LLM implementation. P2 gets CSS-only or minimal stub. Add priority field to `UIPlanSchema`, modify batch selection in `runBatchBuilders()`. Already has `MAX_BATCH_SIZE = 6`. |
| **Cross-stage artifact dependency validation** | Current pipeline trusts manifests blindly at each stage transition. If UX defines 5 flows but API covers only 3, gap propagates silently until Validator (stage 13). Early detection at each transition catches drift before it compounds. | MEDIUM | Post-stage hook in `StageExecutor`: compare new manifest's `covers_features` against PRD feature list. Flag gaps immediately via event bus warning. Reuse logic from `ValidatorAgent.checkFeatureIdTraceability()` but run per-stage. |
| **Cumulative cost tracking per stage** | Pipeline has zero visibility into LLM token consumption. Can't identify cost-inefficient stages or measure optimization impact. `LLMResponse` already returns `usage` with `inputTokens`/`outputTokens`. | LOW | Aggregate `LLMResponse.usage` per stage in `StageExecutor`. Write to `run-metrics.json` alongside `pipeline-state.json`. Display in CLI progress. ~50 lines. Foundation for all future cost optimization. |
| **Prompt caching for shared context** | Multi-stage pipeline re-sends PRD, UX flows, API spec as fresh input to each downstream agent. Anthropic prompt caching reduces input token costs by up to 90% on cached prefixes. These shared artifacts are stable across stages. | MEDIUM | Requires `AnthropicSDKProvider` to set `cache_control` markers on system prompt + shared artifact blocks. Only works with SDK provider, not CLI. Needs `context-manager.ts` to structure cacheable prefix consistently across agents. |
| **Researcher web search capability** | Current Researcher agent generates "research" from LLM training data only -- no real web access. Competitor analysis and technology validation require actual web search for accuracy. | HIGH | Integrate web search tool (Brave API, Exa, or basic fetch) into Researcher agent's allowed tools. Requires MCP tool registration or direct API call. Significant scope: API key management, result parsing, rate limiting, token budget for search results. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Pipeline-level cost caps (hard abort)** | Prevent runaway LLM costs | Mid-pipeline abort leaves artifacts in inconsistent state. Resume from partial abort is fragile. Costs vary wildly by project complexity -- a hard cap would reject legitimate complex projects. | Per-stage soft budgets with warnings via cumulative cost tracking. Let human decide to abort. Already have `max_budget_usd` in Coder autonomy config. |
| **LLM-as-judge quality scoring** | Score every artifact 1-10 for quality | LLM judges are unreliable evaluators of their own output (documented judge bias). High token cost (~$0.10+ per evaluation) for marginal signal. Calibration drift requires ongoing maintenance. | Programmatic checks (stub detection, coverage verification, file integrity) are deterministic, free, and reproducible. Use LLM only for checks humans can't automate (e.g., "does this UX flow make sense?"). |
| **Full AST analysis for stub detection** | Parse TypeScript AST to detect empty function bodies, unreachable code, dead exports | Full AST parsing via `typescript` compiler API or `ts-morph` adds ~50MB dependency, complex setup, and fragile behavior on generated code with non-standard patterns. Setup/teardown overhead per file. | Regex-based heuristics catch 95%+ of cases: `<div>Name</div>`, `return null`, `// TODO`, empty arrow functions `() => {}`, single-line stubs. Zero dependencies, runs in <100ms. |
| **Ensemble verification (multi-model consensus)** | Run same step through multiple models, require agreement for quality | 2-3x cost increase per stage. Different models have different failure modes -- consensus doesn't mean correctness. Latency doubles minimum. Complicates provider selection and error handling. | Single model with programmatic post-checks. Deterministic validation catches more real issues than model agreement ever would. |
| **Real-time parallel stage execution** | Run independent stages concurrently to cut total time | Pipeline is fundamentally sequential -- each stage consumes prior stage's output. Only post-code stages (security + reviewer) could parallel, saving ~5% of run time. Architecture complexity far exceeds time savings. | Keep sequential. Optimize the expensive stages directly: UI Designer batching (saves 30%), fix loop stagnation detection (saves 24%). Much higher ROI. |
| **Automatic prompt tuning via evolution** | Let evolution engine auto-apply prompt improvements | Already exists but requires human approval (by design). Auto-applying prompt changes risks quality regression cascades where a "better" prompt for one project breaks another. Evolution mutations are not safely reversible mid-run. | Keep human-approve gate on evolution. Track metrics to make approval decisions data-driven once cumulative cost tracking is in place. |

## Feature Dependencies

```
[Test file validity pre-check]
    |
    +--required by--> [Error category distinction in Tester]
                          |
                          +--enables--> [Fix loop stagnation detection]
                          |
                          +--enables--> [Intelligent root cause diagnosis]

[Stub/placeholder detection]
    |
    +--enhances--> [Manifest stub-vs-real distinction]
    |                  |
    |                  +--enables--> [Validator content spot-checking]
    |
    +--enables--> [Cross-stage artifact dependency validation]

[Cumulative cost tracking]
    |
    +--enables--> [UI Designer token budget control]
    |
    +--enables--> [Prompt caching] (need baseline to measure improvement)

[Researcher web search] -- independent, no dependencies on above
```

### Dependency Notes

- **Test file pre-check required by error categorization:** Pre-check separates parse errors from test execution before Tester even runs. Categorization then structures the remaining errors.
- **Stub detection enhances manifest distinction:** Programmatic stub detection provides the data that populates `implementation_status` in the manifest schema.
- **Manifest distinction enables spot-checking:** Validator can prioritize checking files marked `'complete'` to verify the claim, and flag `'stub'` files as quality gaps.
- **Cost tracking enables budget control:** Can't set or enforce per-stage budgets without measuring current consumption first.
- **Stagnation detection depends on error categorization:** Meaningful stagnation comparison requires structured failure data, not raw string diffing.

## MVP Definition

### Launch With (v1.1)

Minimum set to address the critical quality failures documented in run-1774640936546.

- [x] **Stub/placeholder detection** -- Eliminates #1 quality problem (manifest lies about coverage)
- [x] **Error category distinction in Tester** -- Eliminates futile fix loop rounds (was 24% of run time)
- [x] **Fix loop stagnation detection** -- Short-circuits when no progress is being made
- [x] **Test file validity pre-check** -- Foundation for error categorization, catches infra issues early
- [x] **Manifest stub-vs-real distinction** -- Makes code.manifest.json trustworthy
- [x] **Validator content spot-checking** -- Catches manifest lies at final validation gate

### Add After Validation (v1.2)

Features that improve efficiency once quality baseline is established.

- [ ] **Cumulative cost tracking** -- Add when users ask "why did this run cost $X?" or to measure v1.1 improvements
- [ ] **UI Designer token budget control** -- Add when cost tracking confirms UI Designer dominates cost
- [ ] **Cross-stage artifact dependency validation** -- Add if feature gaps still reach Validator despite v1.1 checks
- [ ] **Prompt caching** -- Add when cost tracking shows shared context is the dominant cost driver

### Future Consideration (v2+)

- [ ] **Intelligent root cause diagnosis** -- Needs data from multiple v1.1 runs to tune strategy mapping
- [ ] **Researcher web search** -- Large scope (API integration, key management, result parsing), independent project

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Stub/placeholder detection | HIGH | LOW | **P1** |
| Test file validity pre-check | HIGH | LOW | **P1** |
| Fix loop stagnation detection | HIGH | LOW | **P1** |
| Error category distinction in Tester | HIGH | MEDIUM | **P1** |
| Manifest stub-vs-real distinction | HIGH | MEDIUM | **P1** |
| Validator content spot-checking | HIGH | MEDIUM | **P1** |
| Cumulative cost tracking | MEDIUM | LOW | **P2** |
| UI Designer token budget control | MEDIUM | MEDIUM | **P2** |
| Cross-stage artifact dependency validation | MEDIUM | MEDIUM | **P2** |
| Prompt caching | MEDIUM | MEDIUM | **P2** |
| Intelligent root cause diagnosis | HIGH | HIGH | **P3** |
| Researcher web search | MEDIUM | HIGH | **P3** |

**Priority key:**
- P1: Must have -- addresses known critical failures from v1.0 production run
- P2: Should have -- measurable efficiency gains, add once P1 quality baseline is solid
- P3: Nice to have -- high complexity, needs more production data or significant infrastructure

## Competitor Feature Analysis

| Feature | CrewAI/LangGraph | AutoGen | Mosaicat (v1.0) | Mosaicat (v1.1 target) |
|---------|-----------------|---------|-----------------|----------------------|
| Stage-level quality gates | Manual checkpoints, output parsers | Teachable agents with feedback | Manifest Zod schema validation only | Programmatic content validation + stub detection + spot-checking |
| Error classification in fix loops | Generic exception handling | Code executor error parsing | `classifyError()` on raw strings (8 categories) | Structured categories with strategy-aware fix approach selection |
| Fix/retry loop intelligence | Configurable max iterations | Human feedback integration | Progressive strategy (5 rounds, no stagnation detection) | Stagnation-aware with early abort + error-type-aware strategy |
| Cost visibility | LangSmith tracing (external) | Token logging per agent | None | Per-stage token tracking in run-metrics.json |
| Artifact content validation | Output parsers (schema only) | None built-in | Zod schema + file existence check | Schema + content sampling + stub detection + feature traceability |
| Test infrastructure handling | N/A (no built-in testing) | Code executor with error output | No distinction (parse errors = test failures) | Pre-compilation check + structured error categorization |
| Manifest trustworthiness | N/A | N/A | Self-reported by LLM, unverified | Programmatically verified with implementation_status per file |

## Sources

- [Mosaicat run-1774640936546 analysis](../../.planning/debug/run-analysis-1774640936546.md) -- Primary quality baseline: 13 placeholder components, 14/16 test files unparseable, 5 futile fix loop rounds
- [Agentic Engineering: Dual Quality Gates](https://www.sagarmandal.com/2026/03/15/agentic-engineering-part-7-dual-quality-gates-why-validation-and-testing-must-be-separate-processes/) -- Separation of validation and testing as separate processes
- [20 Agentic AI Workflow Patterns](https://skywork.ai/blog/agentic-ai-examples-workflow-patterns-2025/) -- Critic/judge pattern for quality gates without human review
- [Why AI Agents Break: Production Failures](https://arize.com/blog/common-ai-agent-failures/) -- Error propagation patterns, failure clustering in production agents
- [7 AI Agent Failure Modes](https://galileo.ai/blog/agent-failure-modes-guide) -- Fix loop anti-patterns, ensemble verification tradeoffs
- [LLM Token Optimization](https://redis.io/blog/llm-token-optimization-speed-up-apps/) -- Prompt caching (90% reduction), context compression strategies
- [Optimize LLM API Costs: Token Strategies](https://sparkco.ai/blog/optimize-llm-api-costs-token-strategies-for-2025) -- Systematic optimization achieving 60-80% cost reduction
- [Detecting Hallucinations via AST Analysis](https://arxiv.org/html/2601.19106v1) -- AST vs regex tradeoffs; deterministic analysis catches 77% of code hallucinations
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) -- Sequential pipeline with LoopAgent quality gate patterns
- [Reducing MCP Token Usage by 100x](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2) -- Dynamic toolset optimization for token reduction
- [Agents At Work: 2026 Playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) -- Production reliability patterns for agentic workflows
- [Characterizing Faults in Agentic AI](https://arxiv.org/html/2603.06847v1) -- Taxonomy of fault types, symptoms, and root causes in agent systems

---
*Feature research for: Multi-agent LLM pipeline quality and cost optimization (v1.1)*
*Researched: 2026-03-28*
