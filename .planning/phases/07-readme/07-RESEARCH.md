# Phase 7: 优化readme内容 - Research

**Researched:** 2026-03-27
**Domain:** Documentation / README rewrite for v2 architecture accuracy
**Confidence:** HIGH

## Summary

This phase is a documentation-only update to README.md (Chinese) and README.en.md (English). The primary work is correcting technical inaccuracies introduced by the v2 core engine rewrite (phases 2-6) and reorganizing the structure for an AI-savvy developer audience. Both files are ~500 lines of GitHub-flavored markdown with badges, mermaid diagrams, and tables.

The key technical inaccuracies are well-defined: "LLM infinite retry" must become "bounded retry (max 20) + circuit breaker (5-failure threshold, 30s recovery)"; the architecture diagram must reflect the v2 module decomposition (PipelineLoop, StageExecutor, FixLoopRunner, ShutdownCoordinator, ArtifactStore, RunContext); the Orchestrator description must reflect its thin-facade nature (181 lines, delegates to PipelineLoop); and the fix loop description must reflect the progressive strategy (rounds 1-2 direct-fix, round 3 replan, rounds 4-5 full-history).

**Primary recommendation:** Treat this as a structured content rewrite with a verified accuracy checklist. No code changes, no dependencies, no build step. The main risk is inconsistency between the two README files.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Update ALL technical claims to match v2 architecture: iterative pipeline loop (not recursive), ArtifactStore per-run (not global mutable state), StageExecutor, FixLoopRunner with 5-round progressive strategy, ShutdownCoordinator for graceful SIGINT, RetryingProvider with circuit breaker (max 20 retries + 5-failure breaker, NOT "infinite retry")
- **D-02:** Update both README.md (Chinese) and README.en.md (English) simultaneously -- keep them consistent
- **D-03:** Keep dev-mode CLI commands (`npx tsx src/index.ts run`) -- project is not published to npm
- **D-04:** Primary audience: AI-savvy developers who already know LLMs and want a multi-agent pipeline tool
- **D-05:** Shift tone from marketing to more technical -- drop marketing flourishes, make it read like proper technical documentation
- **D-06:** Reorganize section order -- lead with demo/example output, move comparison earlier, consolidate usage modes into quick start
- **D-07:** Replace TODO placeholder for banner image -- remove it entirely (text-only header is fine)
- **D-08:** Replace TODO placeholder for demo GIF with a real terminal screenshot or terminal recording (e.g., asciinema) of a pipeline run. No custom graphics.

### Claude's Discretion
- Exact section ordering (user said "you decide" -- pick what works best for AI-savvy developers)
- How to word the v2 architecture changes (expose internal class names vs describe behavior)
- Level of detail in pipeline diagram and agent table updates
- How to integrate terminal screenshot reference (inline or linked)

### Deferred Ideas (OUT OF SCOPE)
- Custom banner image / logo design -- out of scope for this phase
- npm package publishing and `npx mosaicat` commands -- future milestone
- Documentation site (docs/) with deeper architecture content -- future milestone
</user_constraints>

## Standard Stack

Not applicable -- this phase modifies only markdown files (README.md, README.en.md). No libraries, no code changes, no build steps.

## Architecture Patterns

### v2 Technical Facts Checklist (for README accuracy)

These are the verified facts from reading source code that MUST be reflected in the updated READMEs.

| Claim in Current README | Actual v2 Behavior | Source File | Confidence |
|---|---|---|---|
| "LLM infinite retry" / "LLM 无限重试" | Bounded: max 20 retries + circuit breaker (5 consecutive failures opens circuit, 30s recovery in HALF_OPEN) | `src/core/retrying-provider.ts` lines 16-25 | HIGH |
| Orchestrator as monolith | Thin facade (181 lines), delegates to PipelineLoop | `src/core/orchestrator.ts` (181 lines total) | HIGH |
| "fix loop x5" (undifferentiated) | 5-round progressive strategy: rounds 1-2 direct-fix, round 3 replan-failed-modules, rounds 4-5 full-history-fix | `src/core/fix-loop-runner.ts` lines 16-24 | HIGH |
| No mention of graceful shutdown | ShutdownCoordinator: SIGINT/SIGTERM handled, AbortController signal propagated to PipelineLoop, double-SIGINT force exits | `src/core/shutdown-coordinator.ts` | HIGH |
| Artifact I/O global state | ArtifactStore: per-run instance, scoped directory | `src/core/artifact-store.ts` | HIGH |
| No mention of RunContext | RunContext bundles ArtifactStore/Logger/Provider/EventBus/Config/AbortSignal as immutable context | `src/core/run-context.ts` | HIGH |
| No mention of StageExecutor | StageExecutor: single-stage execution, returns StageOutcome discriminated union, never recurses | `src/core/stage-executor.ts` | HIGH |
| No mention of PipelineLoop | PipelineLoop: while-loop stage iteration, checks abort signal, interprets StageOutcome | `src/core/pipeline-loop.ts` | HIGH |
| Architecture diagram missing v2 modules | Diagram needs: PipelineLoop, StageExecutor, FixLoopRunner, ShutdownCoordinator, RunContext | Multiple files | HIGH |

### Recommended Section Order for AI-Savvy Developers

Based on D-06 (reorganize) and discretion on exact ordering:

```
1. Header (text-only, badges -- no banner image per D-07)
2. One-liner description
3. Demo / Example output (terminal screenshot per D-08, or pipeline output sample)
4. Comparison table (moved up per D-06)
5. Quick Start (consolidated: prerequisites + setup + basic run + modes)
6. How It Works (pipeline diagram + agent table -- updated for v2)
7. Pipeline Profiles
8. Architecture (updated mermaid + v2 module descriptions)
9. Design Principles (trimmed, more technical per D-05)
10. Outputs (artifact directory listing)
11. Roadmap
12. Contributing + License
```

### Anti-Patterns to Avoid
- **Marketing flourishes in technical sections:** Drop phrases like "paradigm shift", "revolutionary". State what it does, not how impressive it is.
- **Inconsistency between README.md and README.en.md:** Every structural change must be applied to both files in the same task.
- **Stale claims:** Never reference "infinite retry" or imply unbounded behavior when the code has explicit limits.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal recording | Custom screenshot tooling | Static terminal output block (code fence with ANSI-stripped output) | No recording tools installed (asciinema, svg-term, terminalizer all absent). Use a formatted code block showing CLI progress output instead. |
| Bilingual sync | Manual diff between files | Side-by-side editing in same plan task | Both files share identical structure; editing them together prevents drift |

**Key insight:** D-08 says "real terminal screenshot or terminal recording." Since no recording tools are installed, the practical approach is either: (a) run the pipeline and take a macOS screenshot, or (b) use a formatted code block showing typical CLI progress output. Option (b) is more maintainable and doesn't require a binary asset.

## Common Pitfalls

### Pitfall 1: Chinese-English Drift
**What goes wrong:** One file gets updated, the other doesn't, or structural changes diverge.
**Why it happens:** Editing 500-line markdown files sequentially is error-prone.
**How to avoid:** Plan tasks to edit both files in the same step. Use the Chinese version as primary, then translate to English in the same task.
**Warning signs:** Section count mismatch, table row count mismatch.

### Pitfall 2: Over-Exposing Internal Class Names
**What goes wrong:** README reads like API docs instead of product documentation.
**Why it happens:** v2 has many well-named internal classes (StageExecutor, PipelineLoop, etc.) that are tempting to expose.
**How to avoid:** Use class names sparingly -- in the Architecture section and when explaining specific behaviors. The "How It Works" section should describe behavior, not implementation.
**Warning signs:** Non-developer readers would be confused by the README.

### Pitfall 3: Mermaid Diagram Complexity
**What goes wrong:** Architecture diagram becomes too complex with all v2 modules, rendering poorly on GitHub.
**Why it happens:** v2 decomposed monolithic orchestrator into 5+ smaller modules.
**How to avoid:** Show conceptual layers, not every class. Keep the pipeline flow diagram simple (it already works well). Update the architecture diagram to show the key new modules without overwhelming detail.
**Warning signs:** Diagram needs scrolling or is illegible on mobile.

### Pitfall 4: Forgetting to Remove TODO Comments
**What goes wrong:** HTML comments like `<!-- TODO: ... -->` remain in the final output.
**Why it happens:** They're invisible in rendered markdown.
**How to avoid:** Search for all `TODO` in both files and address each one per decisions D-07 and D-08.
**Warning signs:** `grep TODO README.md README.en.md` returns results.

## Code Examples

### Current TODO Placeholders to Address

README.md line 1-3 (and README.en.md line 1-3):
```html
<!-- TODO: Replace with custom banner image (1200x400) -->
```
Action per D-07: Remove entirely. Keep text-only header with badge.

README.md line 48 (and README.en.md line 48):
```html
<!-- TODO: 添加流水线终端输出的 demo GIF 或截图 -->
```
Action per D-08: Replace with formatted terminal output block or actual screenshot.

### Inaccurate Claims to Fix

README.md line 37 / README.en.md line 37:
```markdown
**韧性优先** — LLM 调用无限重试 + Stage Resume 崩溃恢复
```
Must change to describe bounded retry (max 20) + circuit breaker (5 consecutive failures, 30s recovery).

README.md line 57 / README.en.md line 57:
```markdown
- **LLM 无限重试** — 指数退避自动重试暂时性错误（429, 503, 网络断开），只有不可恢复的错误才终止
```
Same fix needed -- bounded, not infinite.

README.md line 308 / README.en.md line 308 (comparison table):
```markdown
| Infinite LLM retry | ✅ Exponential backoff |
```
Must update row label and description to reflect circuit breaker.

README.md line 350 / README.en.md line 346 (Design Principles):
```markdown
- **RetryingProvider** 装饰所有 LLM Provider，指数退避无限重试瞬时错误
```
Must update to bounded retry + circuit breaker.

### Architecture Diagram Updates Needed

The current architecture mermaid diagram (README.md lines 398-442) needs these additions in the "Engine" subgraph:
- `PipelineLoop` (replaces recursive calls)
- `StageExecutor` (single-stage execution)
- `FixLoopRunner` (progressive fix strategy)
- `ShutdownCoordinator` (graceful shutdown)
- `RunContext` (dependency bundle)

The `Orchestrator` node should be labeled as "thin facade" or similar.

## State of the Art

| Old Approach (v1 README) | Current Approach (v2 code) | When Changed | Impact on README |
|---|---|---|---|
| "Infinite LLM retry" | Bounded retry (max 20) + circuit breaker | Phase 3 (EXEC-04) | Must fix all 4+ occurrences |
| Recursive executeStage() | Iterative PipelineLoop + StageOutcome | Phase 3 (EXEC-01, EXEC-03) | Architecture section needs update |
| Monolithic Orchestrator | Thin facade (181 lines) + PipelineLoop + StageExecutor | Phase 5 (ORCH-01) | Architecture diagram + description |
| Global mutable artifact state | ArtifactStore per-run instance | Phase 2 (STATE-01) | Architecture diagram |
| No graceful shutdown | ShutdownCoordinator with AbortSignal | Phase 6 (EXEC-05) | New feature to mention |
| Undifferentiated "fix loop x5" | Progressive strategy (direct-fix / replan / full-history) | Phase 3 (EXEC-02) | Fix loop description needs detail |
| Monolithic Coder | CoderPlanner + CoderBuilder + BuildVerifier + SmokeRunner + OutputGenerator | Phase 4 (CODER-01 to CODER-05) | Optional mention in architecture |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| asciinema | D-08 terminal recording | Not available | -- | Use formatted code block or static screenshot |
| svg-term | D-08 SVG conversion | Not available | -- | Use formatted code block |
| terminalizer | D-08 terminal recording | Not available | -- | Use formatted code block |

**Missing dependencies with no fallback:**
- None blocking.

**Missing dependencies with fallback:**
- Terminal recording tools (asciinema, svg-term, terminalizer) -- all absent. Fallback: use a formatted code block showing typical CLI progress output, or capture a real screenshot by running `npx tsx src/index.ts run` and taking a macOS screenshot. The code block approach is more maintainable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

This phase has no mapped requirement IDs. Validation is structural:

| Check | Behavior | Test Type | Automated Command | Exists? |
|-------|----------|-----------|-------------------|---------|
| No stale claims | "infinite retry" removed from both files | grep | `grep -c "无限重试\|infinite.*retry\|Infinite.*retry" README.md README.en.md` | Wave 0 |
| No TODO placeholders | All TODO HTML comments resolved | grep | `grep -c "TODO" README.md README.en.md` | Wave 0 |
| Bilingual parity | Same section count in both files | grep | `grep -c "^## " README.md README.en.md` | Wave 0 |
| v2 modules mentioned | Key v2 classes appear in architecture | grep | `grep -c "PipelineLoop\|StageExecutor\|FixLoopRunner\|ShutdownCoordinator" README.md` | Wave 0 |
| Circuit breaker mentioned | Bounded retry described accurately | grep | `grep -c "circuit.*breaker\|熔断" README.md README.en.md` | Wave 0 |

### Sampling Rate
- **Per task commit:** Run grep checks above
- **Per wave merge:** Full grep suite
- **Phase gate:** All grep checks pass (zero hits for stale claims, nonzero for v2 modules)

### Wave 0 Gaps
- None -- grep-based validation requires no test infrastructure setup.

## Open Questions

1. **Terminal demo format**
   - What we know: No recording tools installed. D-08 requires "real terminal screenshot or terminal recording."
   - What's unclear: Whether the user prefers a static PNG screenshot (requires running the pipeline) or a formatted code block (can be authored manually).
   - Recommendation: Use a formatted code block showing realistic CLI progress output. It's maintainable, renders well on GitHub, and doesn't require binary assets. If the user insists on a real screenshot, it can be captured separately and added as a PNG.

2. **Architecture diagram granularity**
   - What we know: v2 has 5+ new modules in the engine layer. The current diagram has 6 nodes in the Engine subgraph.
   - What's unclear: How many v2 modules to expose vs keeping it simple.
   - Recommendation: Add PipelineLoop, StageExecutor, FixLoopRunner to the Engine subgraph. Mention ShutdownCoordinator and RunContext in text but keep them out of the diagram to avoid clutter.

## Sources

### Primary (HIGH confidence)
- `src/core/retrying-provider.ts` -- verified max 20 retries, circuit breaker config (5 failures, 30s recovery)
- `src/core/fix-loop-runner.ts` -- verified 5-round progressive strategy with approach selection
- `src/core/shutdown-coordinator.ts` -- verified SIGINT/SIGTERM handling via AbortController
- `src/core/orchestrator.ts` -- verified 181 lines, thin facade pattern
- `src/core/artifact-store.ts` -- verified per-run instance scoping
- `src/core/run-context.ts` -- verified immutable context bundle interface
- `src/core/stage-executor.ts` -- verified single-stage execution, StageOutcome return
- `src/core/pipeline-loop.ts` -- verified while-loop iteration, abort signal check

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- all v1 requirements complete, confirms v2 architecture is stable

## Metadata

**Confidence breakdown:**
- Technical accuracy checklist: HIGH -- all claims verified against source code
- Section reorganization: HIGH -- decisions are clear from CONTEXT.md
- Terminal demo approach: MEDIUM -- depends on user preference between code block vs screenshot
- Architecture diagram: MEDIUM -- discretion on granularity

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable -- documentation phase, no fast-moving dependencies)
