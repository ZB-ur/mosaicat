# Phase 3: Execution Engine - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The pipeline executes via an iterative loop with explicit stage outcomes, finite retries, circuit breakers, and clean shutdown -- no recursion, no infinite retries, no orphaned state on SIGINT.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key areas requiring decisions:
- StageOutcome discriminated union design (variant names, payload shapes)
- FixLoopRunner interface and progressive strategy implementation
- Circuit breaker parameters (5 consecutive failures threshold, 30s half-open recovery from success criteria)
- ShutdownCoordinator signal handling and cleanup strategy
- StageExecutor boundary (what goes in vs stays in PipelineLoop)

### Blockers from STATE.md
- Cockatiel version verification needed (or decide to hand-roll retry+circuit-breaker)
- Resume state file migration strategy (version field vs invalidate old files)
- EventBus event sequence contract undocumented — capture as test fixture

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
