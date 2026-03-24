---
name: state-management-patterns
description: Frontend state management selection and implementation patterns
scope: shared
agents: [coder, tech_lead]
trigger: tech-spec 包含状态管理
---

## Selection Rules
- Simple apps (<10 state slices): Zustand
- Need devtools + middleware: Zustand
- Server state (API caching): TanStack Query
- Do NOT use Redux (unless tech-spec explicitly requires it)
- Do NOT use React Context for global state (performance issues)

## Zustand Patterns
- One store per feature (not a single global store)
- Store files go in stores/ directory
- Actions and state defined in the same store
- Use selectors for derived state
