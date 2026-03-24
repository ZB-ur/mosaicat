# Mosaicat Static Constitution

> Immutable quality rules that apply to ALL generated projects.
> Every agent MUST comply — violations are blocked by post-run hooks.

---

## Article I: Verifiability First

Every agent output MUST include programmatically verifiable quality markers.

- PRD: every feature has a unique `F-NNN` ID
- Tech spec: every task has a unique `T-NNN` ID
- Code: `tsc --noEmit` produces zero errors
- Tests: executable and produce a machine-readable report

## Article II: Spec Is Authority

Downstream agents depend ONLY on upstream spec artifacts, never on reasoning process.

- Coder reads `tech-spec.md` and `api-spec.yaml`, not the LLM conversation that produced them
- Tester reads `test-plan.md` and test code, not the Coder's thought process
- If a spec is incomplete, raise `[NEEDS CLARIFICATION]` — do not infer

## Article III: No Ambiguous Pass-Through

Uncertain information MUST be annotated `[NEEDS CLARIFICATION]` — never guessed or silently filled.

- NEVER fabricate user requirements that were not stated or implied
- NEVER assume a tech stack, library version, or API behavior without evidence
- When in doubt, mark it and move on — a downstream agent or human will resolve it

## Article IV: Acceptance-Driven Completion

Code completion standard = acceptance tests pass, NOT just compilation passes.

- "It compiles" is necessary but not sufficient
- "It runs without errors" is necessary but not sufficient
- "Acceptance tests derived from PRD features pass" is the completion bar
- Every `F-NNN` feature MUST have at least one acceptance test

## Article V: No Placeholder Delivery

User-visible paths MUST NOT contain placeholder content.

- NEVER deliver: `Placeholder`, `Coming Soon`, `TODO`, `Lorem ipsum`, `TBD`, `FIXME`
- NEVER leave empty components, stub pages, or mock data in production paths
- If a feature cannot be fully implemented, omit it entirely rather than stubbing
- Internal developer comments (`// TODO: optimize later`) are acceptable in non-user-visible code

## Article VI: End-to-End Traceability

IDs MUST flow through the entire pipeline without loss.

- `F-NNN` traces: PRD → UX flows → API spec → Tech spec → Code → Tests
- `T-NNN` traces: Tech spec → Code
- Every `F-NNN` in the PRD MUST appear in at least one test
- Every `T-NNN` in the tech spec MUST map to at least one code module
- Missing ID coverage is a blocking validation failure
