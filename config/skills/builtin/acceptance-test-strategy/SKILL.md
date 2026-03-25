---
name: acceptance-test-strategy
description: Acceptance test layering strategy and framework selection
scope: shared
agents: [qa_lead]
trigger: always
---

## Three Test Layers
1. Feature acceptance (tests/acceptance/features/)
   - One test file per F-NNN feature
   - Use Testing Library + happy-dom
   - Test user behavior, not implementation details

2. Interaction flows (tests/acceptance/flows/)
   - One test file per UX flow
   - Multi-step operations via userEvent
   - Verify UI state at each flow step

3. API contracts (tests/acceptance/api/)
   - Generated from OpenAPI spec
   - Verify endpoint exists and response shape is correct
   - Use supertest or fetch for direct requests

## Framework Selection
- Default: vitest + @testing-library/react + happy-dom
- E2E (critical flows only): playwright
- API: vitest + fetch/supertest
