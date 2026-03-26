# Phase 4: Coder Decomposition - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The 1312-line Coder monolith is replaced by 4 focused sub-modules and a thin facade, each independently testable with clear single responsibilities.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase (code decomposition/refactoring). Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key areas requiring decisions:
- Sub-module interface design (CoderPlanner, CoderBuilder, BuildVerifier, SmokeRunner)
- How to split the existing 1312-line coder.ts without breaking existing behavior
- Facade delegation pattern (how coder.ts delegates to sub-modules)
- Test strategy for shell command execution paths in SmokeRunner

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
