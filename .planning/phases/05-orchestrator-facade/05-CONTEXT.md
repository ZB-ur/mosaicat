# Phase 5: Orchestrator Facade + Logging Cleanup - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The Orchestrator is a thin wiring layer that creates RunContext and delegates to PipelineLoop -- all console output goes through Logger, EventBus is instance-scoped.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase (orchestrator refactoring + logging cleanup). Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key areas requiring decisions:
- How to slim the Orchestrator from ~900 lines to <200 lines
- How to wire PipelineLoop (from Phase 3) into the Orchestrator
- Strategy for finding and replacing all console.log/warn/error calls
- EventBus singleton removal approach (already per-run in Phase 2, just need to verify/cleanup)

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
