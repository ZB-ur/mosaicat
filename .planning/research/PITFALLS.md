# Pitfalls Research

**Domain:** Adding quality gates, manifest validation, cost optimization, and error intelligence to existing multi-agent LLM pipeline
**Researched:** 2026-03-28
**Confidence:** HIGH (based on v1.0 run data analysis + codebase review)

---

## Critical Pitfalls

### Pitfall 1: Quality Gates That Reject Based on Heuristics the LLM Can Game

**What goes wrong:**
You add content-level validation (e.g., "detect placeholder `<div>ComponentName</div>` patterns") and the LLM learns to produce slightly different placeholders that pass the check: `<div className="component-name-wrapper"><span>Loading...</span></div>`. The gate passes, but the component is equally non-functional. The quality gate gives false confidence.

**Why it happens:**
Heuristic detection (regex, keyword matching) is a cat-and-mouse game against LLM output. The `PLACEHOLDER_KEYWORDS` array in `build-verifier.ts` already demonstrates this approach -- it checks for `'Coming Soon'`, `'Placeholder'`, `'TODO:'`, `'Lorem ipsum'`. But the v1.0 run showed 13 components with `<div>ComponentName</div>` that none of those keywords catch. Adding more keywords just shifts the problem.

**How to avoid:**
1. **Structural validation over keyword matching.** Instead of scanning for placeholder text, verify functional structure: does the component import and use hooks? Does it render conditional logic? Measure AST node count per component -- a real component has 20+ JSX nodes, a placeholder has 1-3.
2. **Behavioral validation where possible.** Playwright can render the component and check if it has interactive elements, minimum visual complexity (screenshot pixel variance), or correct DOM structure.
3. **Manifest must declare what it skipped, not just what it covered.** Add `skipped_tasks` and `stub_components` arrays to `CodeManifestSchema`. The quality gate blocks if `covers_features` claims coverage that `stub_components` contradicts.

**Warning signs:**
- Quality gate pass rate jumps to 100% immediately after deployment -- real quality gates should fail some runs
- Gate checks all use string matching or regex
- No test exists that verifies the gate rejects known-bad output from the v1.0 run

**Phase to address:**
Phase 1 (manifest schema hardening) -- the schema must distinguish stub vs real before any gate logic is added.

---

### Pitfall 2: Manifest Self-Reporting Without Cross-Verification Creates a Liar's System

**What goes wrong:**
The current manifest system is self-reported: the Coder agent writes `code.manifest.json` claiming `covers_features: ["F-001", ..., "F-013"]` and `covers_tasks: ["T-001", ..., "T-029"]`. In the v1.0 run, it claimed 100% coverage when actual was 45%. Adding more fields to the manifest schema (like `stub_components`) doesn't fix this if the same LLM that produced the stubs also fills in the manifest.

**Why it happens:**
The LLM optimizes for task completion, not accuracy. When the prompt says "generate a manifest listing what you built," the LLM lists everything it was *asked* to build, not what it *actually* built. This is a fundamental limitation of self-reported quality in LLM systems. The `OutputGenerator.generateManifest()` in coder does plan-based manifest generation, not artifact-based.

**How to avoid:**
1. **Programmatic manifest generation, not LLM-generated.** The manifest should be built by scanning actual disk artifacts: parse the AST of each generated file, count exports/components/functions, check import resolution, verify files referenced in manifest actually exist.
2. **The Validator already does some programmatic checks (Check 5-8).** Extend this pattern: move verification from the Validator (end of pipeline) to immediately after each agent (fail fast).
3. **Cross-manifest verification at gate time.** When code.manifest says it covers T-015 (session list component), check that the file listed actually imports React, exports a named component, and has >50 lines of non-comment code.

**Warning signs:**
- Manifest `covers_features` array matches the PRD features list exactly (suspiciously perfect)
- No manifest field is ever empty or partial
- Validator passes with "all checks green" on first run

**Phase to address:**
Phase 1 (manifest schema) + Phase 2 (Coder quality) -- manifest schema adds `implementation_status` enum per task, Coder's `OutputGenerator` switches to AST-based scanning.

---

### Pitfall 3: Fix Loop Error Classification That Over-Engineers Categories But Misses Infrastructure vs Logic

**What goes wrong:**
The v1.0 fix loop ran 5 rounds because it could not distinguish "test file won't parse" (infrastructure) from "assertion failed" (logic). You add an error classifier with categories like `syntax-error`, `import-resolution`, `type-mismatch`, `assertion-failure`, `timeout`, etc. The classifier correctly tags errors, but the fix loop still fails because the *action* for each category is the same: "re-run Coder with error message." The classification adds complexity without changing behavior.

**Why it happens:**
Error classification feels like progress. It makes logs prettier and dashboards richer. But the Coder's ability to fix an error doesn't depend on how we classify it -- it depends on whether the error is in code the Coder controls (fixable) vs infrastructure the Coder cannot change (unfixable). The existing `classifyError()` in `retry-log.ts` already does basic classification, but it doesn't affect the fix strategy.

**How to avoid:**
1. **Binary decision, not taxonomy.** The only question that matters: "Is this error in code the Coder wrote, or in infrastructure/config/test setup?" If infrastructure: abort the fix loop, surface to the user. If code: continue fixing.
2. **Infrastructure errors have signatures.** Parse errors at line 0, `Cannot find module` for packages not in package.json, `SyntaxError: Cannot use import statement` (missing transform), `.tsx` extension in `.ts` test runner config. Detect these specific patterns and short-circuit.
3. **Stagnation detection is more valuable than classification.** If consecutive rounds have identical failure sets (same files, same error counts), abort early. The v1.0 run wasted rounds 2-5 with zero progress -- stagnation detection would have saved 24% of run time.

**Warning signs:**
- Error classifier has 10+ categories but the fix loop treats all categories identically
- Fix loop still runs all 5 rounds on infrastructure errors
- New error categories being added without corresponding fix strategies

**Phase to address:**
Phase 3 (fix loop intelligence) -- implement stagnation detection first (highest ROI), then infrastructure detection, then skip fine-grained classification.

---

### Pitfall 4: UI Cost Optimization That Degrades Output Quality by Cutting the Wrong Things

**What goes wrong:**
UIDesigner took 39min (30% of total run time) and generated 63 components + 73 screenshots. The obvious optimization is to reduce component count. You add a "component budget" that caps output at 30 components. But the UIDesigner now produces 30 large monolithic components instead of 63 focused ones. The downstream Coder receives worse component boundaries, leading to more implementation problems.

**Why it happens:**
LLM cost is driven by: (1) number of LLM calls, (2) tokens per call, (3) screenshot rendering time. Component count affects all three, so capping it seems like the right lever. But the UIDesigner's value is in component decomposition -- that's what informs the Coder's module structure. Reducing component count destroys the decomposition quality.

**How to avoid:**
1. **Cut screenshots, not components.** Screenshot rendering is pure Playwright overhead, not LLM cost. Generate screenshots for page-level components only (5-8 pages), not every atomic component. In the v1.0 run, 73 screenshots for buttons, inputs, and cards added no value.
2. **Cut preview HTML files for atomic components.** Preview HTML is useful for page compositions but unnecessary for `<Button>`, `<Card>`, `<Badge>`.
3. **Batch component code generation.** Instead of one LLM call per component, group related components (all form components, all card variants) into single calls. This reduces call count without reducing output quality.
4. **Measure cost in tokens/dollars, not component count.** The optimization target is cost, not component count. Track `LLMUsage` per stage and set a token budget, not a component budget.

**Warning signs:**
- Component count decreased but LLM token usage didn't change proportionally
- Coder receives fewer, larger components and produces worse code structure
- Screenshot rendering time is still the dominant cost factor after "optimization"

**Phase to address:**
Phase 4 (UI cost optimization) -- implement screenshot tiering first (page vs atomic), then batch generation, then token budget tracking.

---

### Pitfall 5: Intent Enrichment That Adds LLM Calls Without Measurable Downstream Impact

**What goes wrong:**
You add "structured user persona," "competitive landscape," and "real web research" to IntentConsultant and Researcher. Each addition costs 1-3 minutes and $0.10-0.50 in tokens. The enriched intent-brief and research artifacts look more professional, but the ProductOwner produces the same PRD because it was already distilling user intent into features. The downstream agents never consume the extra fields.

**Why it happens:**
Early pipeline enrichment feels high-leverage ("better input = better output everywhere"). But the pipeline has a bottleneck at ProductOwner: it reduces all upstream context to `prd.md`, and that PRD format is what downstream agents actually read. If the PRD template doesn't have fields for "user persona" or "competitive landscape," the enrichment is wasted.

**How to avoid:**
1. **Trace downstream consumption before adding upstream enrichment.** Before enriching intent-brief, verify: does ProductOwner's prompt reference the new fields? Does the PRD template include them? Does any downstream agent read them from the PRD?
2. **Measure impact with A/B comparison.** Run the pipeline twice with the same instruction -- once with enriched intent, once without. Diff the PRD output. If the diff is cosmetic, the enrichment has no value.
3. **If adding web research (Researcher agent), verify it reaches the Coder.** The Researcher writes `research.md`, but the Coder only reads `tech-spec.md` and `api-spec.yaml`. Research findings must flow through TechLead to have any effect on code quality.

**Warning signs:**
- New fields added to intent-brief.json that no downstream agent references in its prompt
- Researcher output grows 3x but PRD remains the same length
- Intent enrichment adds >2 minutes to pipeline with no quality change in final artifacts

**Phase to address:**
Phase 5 (intent enrichment) -- this should be the LAST phase, after all downstream quality gates are in place so you can measure whether enrichment actually changes gate pass rates.

---

### Pitfall 6: Adding Validation Everywhere Creates a Pipeline That Mostly Validates Itself

**What goes wrong:**
You add: post-agent manifest validation, cross-manifest coverage checks, AST-based stub detection, test infrastructure pre-checks, build artifact analysis, stagnation detection, and Validator content sampling. Each check is individually reasonable. Together, they add 5-15 minutes of validation overhead to every run, and the pipeline spends more time checking its work than doing its work. Worse, validation failures trigger retries, which trigger more validation, creating a cascade.

**Why it happens:**
After a bad run (like v1.0's 45% real coverage), the instinct is to add checks everywhere. Each check addresses a real failure mode. But the cumulative cost is invisible because each check is designed independently.

**How to avoid:**
1. **Budget validation time.** Total validation overhead should be <10% of pipeline duration. Currently, post-code stages (security + review + validate) take 5% of total time. Adding checks should not more than double this.
2. **Fail fast, don't validate late.** A stub detection check after Coder is worth 10x more than the same check in Validator (which runs 5 stages later). Invest in early gates, not late comprehensive validation.
3. **Make validation checks fast and programmatic.** AST parsing, file size checks, import resolution -- these take milliseconds. Don't use LLM calls for validation that can be done programmatically.
4. **Validation that triggers retry must be counted as retry cost.** If a quality gate fails Coder 3 times, that's 3x Coder cost. The gate is only worthwhile if the 3rd attempt produces significantly better output than the 1st would have without the gate.

**Warning signs:**
- Pipeline duration increases >20% after adding quality gates
- Most gate failures lead to retries that produce the same output
- Multiple validation stages check the same things redundantly (e.g., Validator check 5-8 overlap with post-Coder checks)

**Phase to address:**
Cross-cutting concern -- every phase must track the time cost of its additions and verify they don't create cascading retries.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keyword-based stub detection (`PLACEHOLDER_KEYWORDS` array) | Quick to implement, catches obvious stubs | LLM generates slightly different stubs that bypass detection; constant keyword maintenance | Never as the sole detection mechanism; OK as a fast pre-filter before AST analysis |
| Token tracking via post-hoc log parsing | No code changes to LLM provider | Inaccurate (misses retries, doesn't capture per-stage breakdown), can't enforce budgets in real-time | MVP only; must move to `LLMUsage` accumulation in provider for real budgets |
| Hardcoded error patterns for fix-loop classification | Quick implementation, addresses known v1.0 failures | New error patterns not covered, brittle regex matching | Acceptable if combined with stagnation detection as fallback |
| Self-reported manifest with post-hoc validation | Minimal code change, keeps current agent architecture | False coverage reports until validator runs (too late), validator adds pipeline time | Never for code.manifest; acceptable for design-stage manifests (PRD, UX, API) where human reviews anyway |
| Screenshot budget as component count cap | Simple to implement, directly reduces Playwright time | Destroys component decomposition quality, wrong optimization target | Never; use page-level-only screenshot policy instead |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Post-agent validation + retry logic | Gate fails agent, retry re-runs agent, agent produces same output, gate fails again (infinite loop) | Set max gate-failures per stage (2), and on final failure, mark stage as `done_with_warnings` rather than blocking |
| AST-based stub detection + generated code | Parsing JSX/TSX requires full TypeScript compiler setup; `ts.createSourceFile()` alone doesn't resolve imports | Use `typescript` compiler API with `ts.createSourceFile()` for syntax-only checks (sufficient for stub detection); don't attempt full type checking on generated code |
| Token tracking + RetryingProvider | RetryingProvider wraps calls with automatic retries; token tracking at the outer layer misses retry overhead | Track tokens inside the base provider (`AnthropicSDKProvider`, `ClaudeCLIProvider`), not in wrapping layers |
| Stagnation detection + fix loop state | Comparing "same failures" requires normalizing error messages (line numbers change between rounds) | Compare failure *signatures* (file + error type), not raw error strings |
| Manifest cross-verification + resume | Resume skips completed stages but cross-verification needs manifests from all stages; some manifests may not exist if early stages were from a previous run format | Always check manifest existence before cross-referencing; missing manifest = skip that check, don't crash |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| AST parsing every generated file after every Coder module | Each `ts.createSourceFile()` is fast (~5ms) but reading 50+ files from disk after each of 10 modules = 500 reads per run | Parse only files in the current module, not all files; cache parse results across modules | >100 generated files per run |
| Playwright screenshot rendering for all components | 73 screenshots at ~10s each = ~12 minutes pure rendering time | Screenshot only page-level compositions (5-8 pages); skip atomic components | >30 components |
| LLM-based validation (calling LLM to assess quality of LLM output) | Each validation call costs $0.05-0.20 and 30-60 seconds; multiple validation points multiply this | Programmatic validation for structural checks; reserve LLM validation for semantic quality only | >3 LLM validation calls per pipeline run |
| Full test suite execution in fix loop | Running all 16 test suites when only 1 module changed | Run only test files that import from the changed module; use vitest's `--related` flag | >20 test files |

## Security Mistakes

Not applicable to this domain (quality gates and cost optimization don't introduce new security surfaces). The existing SecurityAuditor stage handles code security concerns.

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Quality gate rejects a run that was "good enough" for the user | User waited 2 hours, pipeline says "FAIL" on a component that user doesn't care about | Quality gates should produce warnings, not hard failures, for non-critical issues; only block on critical issues (all components are stubs, no tests pass) |
| Token/cost tracking shown as raw numbers without context | User sees "$4.23 spent" but doesn't know if that's good or bad | Show cost relative to baseline ("23% less than average run") and breakdown by stage |
| Fix loop runs silently for 30 minutes with no user feedback | User thinks pipeline is stuck; considers killing the process | Emit progress events during fix loop with round number, approach, and failure count; show estimated time remaining |
| Stagnation detection aborts fix loop but user doesn't understand why | Pipeline ends with "fix loop aborted: stagnation detected" -- not actionable | Explain what's stagnant (same 14 test files failing with parse errors), suggest manual action (fix vitest.config.ts for TSX support) |

## "Looks Done But Isn't" Checklist

- [ ] **Quality gate deployed:** Often missing test that verifies the gate rejects known-bad output -- verify by running the gate against actual v1.0 artifacts
- [ ] **Manifest schema extended:** Often missing migration for existing manifests -- verify that `readManifest()` handles old-format manifests gracefully (Zod `.optional()` or `.default()`)
- [ ] **Fix loop stagnation detection:** Often missing normalization of error strings between rounds -- verify by comparing round N and round N+1 failure sets from a real fix loop log
- [ ] **Token tracking added:** Often missing tracking of retry attempts and clarification rounds -- verify total tracked tokens match actual API usage in billing dashboard
- [ ] **Screenshot optimization:** Often missing fallback for when page-level screenshots fail (component not mountable standalone) -- verify with a component that has required providers/context
- [ ] **Error classification deployed:** Often missing the mapping from classification to action -- verify that at least one error category triggers a different fix strategy than the default
- [ ] **Validator content sampling:** Often missing handling of stages that produce binary/non-text artifacts (screenshots, gallery.html) -- verify Validator doesn't crash on non-text artifacts
- [ ] **Cross-manifest verification:** Often missing handling of partial pipeline runs (design-only profile has no code.manifest) -- verify checks are profile-aware

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Quality gate too strict (blocking good runs) | LOW | Add `--skip-gates` CLI flag; relax threshold; gate failures produce warnings not blocks |
| Quality gate too loose (missing bad output) | MEDIUM | Audit failed run artifacts; add detection pattern; re-run pipeline |
| Fix loop runs all 5 rounds uselessly | LOW | Add stagnation detection (compare failure sets); no data loss, just time waste |
| Manifest claims false coverage | MEDIUM | Switch to programmatic manifest generation; re-validate existing runs |
| Token tracking shows wrong numbers | LOW | Fix tracking points; no functional impact, just reporting accuracy |
| Cost optimization degrades UI quality | HIGH | Revert component budget; redesign optimization to target screenshots/batching instead of component count |
| Intent enrichment adds latency with no quality gain | LOW | Disable enrichment features; no downstream dependency |
| Cascading validation overhead | MEDIUM | Profile pipeline timing; disable redundant checks; consolidate validation points |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1: Gameable heuristic gates | Phase 1 (manifest hardening) | Run gate against v1.0 artifacts; must reject the 13 placeholder components |
| P2: Self-reported manifest lying | Phase 1 (manifest hardening) + Phase 2 (Coder quality) | Generate manifest programmatically; compare against LLM-reported manifest; they should diverge on stub components |
| P3: Over-engineered error classification | Phase 3 (fix loop) | Replay v1.0 fix loop logs; stagnation detector should abort after round 2; infrastructure errors should be flagged before round 1 |
| P4: Wrong cost optimization target | Phase 4 (UI cost) | Measure cost in tokens and time, not component count; screenshot count should drop 80%+ while component count stays similar |
| P5: Wasteful intent enrichment | Phase 5 (intent enrichment) | A/B comparison: enriched vs non-enriched intent; diff PRD output; difference must be non-cosmetic |
| P6: Validation cascade overhead | All phases | Pipeline duration with all gates < 1.15x pipeline duration without gates (15% overhead budget) |

## Sources

- Run analysis: `.planning/debug/run-analysis-1774640936546.md` (real v1.0 failure data, HIGH confidence)
- Codebase: `src/core/manifest.ts` (current manifest schemas), `src/agents/coder/build-verifier.ts` (current placeholder detection), `src/core/fix-loop-runner.ts` (current fix loop strategy), `src/agents/validator.ts` (current validation approach), `src/core/stage-executor.ts` (current retry/gate logic)
- Project context: `.planning/PROJECT.md` (v1.1 feature targets)

---
*Pitfalls research for: quality gates, manifest validation, cost optimization, error intelligence in multi-agent LLM pipeline*
*Researched: 2026-03-28*
