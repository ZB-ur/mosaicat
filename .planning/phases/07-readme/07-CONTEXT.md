# Phase 7: 优化readme内容 - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Update README.md and README.en.md to reflect the v2 core engine rewrite. Fix all technical inaccuracies, reorganize structure for AI-savvy developers, shift tone from marketing to technical, and add a terminal screenshot of a real pipeline run.

</domain>

<decisions>
## Implementation Decisions

### Content accuracy
- **D-01:** Update ALL technical claims to match v2 architecture: iterative pipeline loop (not recursive), ArtifactStore per-run (not global mutable state), StageExecutor, FixLoopRunner with 5-round progressive strategy, ShutdownCoordinator for graceful SIGINT, RetryingProvider with circuit breaker (max 20 retries + 5-failure breaker, NOT "infinite retry")
- **D-02:** Update both README.md (Chinese) and README.en.md (English) simultaneously — keep them consistent
- **D-03:** Keep dev-mode CLI commands (`npx tsx src/index.ts run`) — project is not published to npm

### Target audience & tone
- **D-04:** Primary audience: AI-savvy developers who already know LLMs and want a multi-agent pipeline tool
- **D-05:** Shift tone from marketing to more technical — drop marketing flourishes, make it read like proper technical documentation

### Structure
- **D-06:** Reorganize section order — lead with demo/example output, move comparison earlier, consolidate usage modes into quick start

### Claude's Discretion
- Exact section ordering (user said "you decide" — pick what works best for AI-savvy developers)
- How to word the v2 architecture changes (expose internal class names vs describe behavior)
- Level of detail in pipeline diagram and agent table updates
- How to integrate terminal screenshot reference (inline or linked)

### Visual assets
- **D-07:** Replace TODO placeholder for banner image — remove it entirely (text-only header is fine)
- **D-08:** Replace TODO placeholder for demo GIF with a real terminal screenshot or terminal recording (e.g., asciinema) of a pipeline run. No custom graphics.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source files to update
- `README.md` — Chinese README (506 lines, primary)
- `README.en.md` — English README (502 lines, must stay in sync)

### v2 Architecture references (for accuracy)
- `src/core/fix-loop-runner.ts` — FixLoopRunner: 5-round progressive strategy (direct-fix, replan, full-history)
- `src/core/stage-executor.ts` — StageExecutor: single-stage execution, no recursion
- `src/core/shutdown-coordinator.ts` — ShutdownCoordinator: graceful SIGINT/SIGTERM
- `src/core/retrying-provider.ts` — RetryingProvider: max 20 retries + circuit breaker (5 consecutive failures)
- `src/core/orchestrator.ts` — Thin facade (<200 lines), delegates to PipelineLoop
- `src/core/artifact-store.ts` — ArtifactStore: per-run instance scoping
- `src/core/run-context.ts` — RunContext: bundles all per-run dependencies
- `src/agents/coder/output-generator.ts` — OutputGenerator: uses ArtifactIO (not legacy globals)

### Pipeline config
- `config/pipeline.yaml` — Stage definitions, profiles, gate settings
- `config/agents.yaml` — Agent input/output contracts

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Mermaid pipeline diagram in current README — can be updated in place
- Agent table (13 rows) — structure is good, just needs content accuracy updates

### Established Patterns
- README uses GitHub-flavored markdown with badges, centered header, mermaid diagrams
- Both README files follow identical structure (Chinese/English parallel)

### Integration Points
- `package.json` — may have scripts that README references
- `config/pipeline.yaml` — profile definitions referenced in README

</code_context>

<specifics>
## Specific Ideas

- The "fix loop x5" in the mermaid diagram should reflect FixLoopRunner's progressive strategy: rounds 1-2 direct-fix, round 3 replan-failed-modules, rounds 4-5 full-history-fix
- "LLM 无限重试" must change to describe circuit breaker behavior accurately
- Terminal screenshot should show a real pipeline run with the CLI progress output (stage names, timing, pass/fail indicators)

</specifics>

<deferred>
## Deferred Ideas

- Custom banner image / logo design — out of scope for this phase
- npm package publishing and `npx mosaicat` commands — future milestone
- Documentation site (docs/) with deeper architecture content — future milestone

</deferred>

---

*Phase: 07-readme*
*Context gathered: 2026-03-27*
