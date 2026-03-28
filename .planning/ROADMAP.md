# Roadmap: Mosaicat

## Milestones

- ✅ **v1.0 Core Engine Rewrite** - Phases 1-7 (shipped 2026-03-28) -- [Archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Quality & Cost Optimization** - Phases 8-12 (in progress)

## Phases

<details>
<summary>✅ v1.0 Core Engine Rewrite (Phases 1-7) - SHIPPED 2026-03-28</summary>

- [x] Phase 1: Test Infrastructure Hardening (3/3 plans)
- [x] Phase 2: Foundation Layer (4/4 plans)
- [x] Phase 3: Execution Engine (3/3 plans)
- [x] Phase 4: Coder Decomposition (3/3 plans)
- [x] Phase 5: Orchestrator Facade + Logging Cleanup (3/3 plans)
- [x] Phase 6: Integration Wiring Fixes (2/2 plans)
- [x] Phase 7: README (1/1 plan)

</details>

### 🚧 v1.1 Quality & Cost Optimization

**Milestone Goal:** 提升全链路产出物质量（消灭 placeholder/虚报覆盖率/无效测试），优化 UI 设计成本和 fix loop 效率

- [ ] **Phase 8: Agent Architecture Fixes** - Fix tool-use, constitution persistence, output formats, manifest schemas, and hook activation
- [ ] **Phase 9: Quality Gate Infrastructure** - Programmatic post-agent quality checks that block bad output from advancing
- [ ] **Phase 10: Test Fix Loop Intelligence** - Pre-compilation checks, error classification, and stagnation detection
- [ ] **Phase 11: Cost Tracking & Optimization** - Per-stage token tracking, UI Designer cost reduction, and prompt caching
- [ ] **Phase 12: Intent & Research Enrichment** - Real web search for Researcher, structured user profiling for IntentConsultant

## Phase Details

### Phase 8: Agent Architecture Fixes
**Goal**: Every agent's tool-use, output format, and contract enforcement works correctly -- the foundation all downstream quality improvements depend on
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06
**Success Criteria** (what must be TRUE):
  1. An agent configured with `allowed_tools` in agents.yaml can call those tools during execution (tool-use mode works alongside or instead of structured output)
  2. Researcher agent calls web search tools and returns results with citations from real URLs
  3. `constitution_project` written by ProductOwner/TechLead exists on disk and is loaded by downstream agents
  4. UXDesigner and APIDesigner produce output that matches their prompt specifications without format contradictions
  5. Every manifest write is validated against its Zod schema (invalid data throws), and BaseAgent post-run hooks fire after agent execution
**Plans:** 3 plans
Plans:
- [x] 08-01-PLAN.md — ToolUseAgent base class + Researcher migration
- [x] 08-02-PLAN.md — Constitution persistence + output format alignment
- [x] 08-03-PLAN.md — Manifest validation hardening + hook activation

### Phase 9: Quality Gate Infrastructure
**Goal**: Pipeline stages cannot advance when output contains stubs, placeholder components, or misreported coverage -- bad output is blocked, not passed through
**Depends on**: Phase 8
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05
**Success Criteria** (what must be TRUE):
  1. A stage producing placeholder components (empty div shells, empty function bodies, TODO/FIXME markers) is blocked from advancing to the next stage
  2. code.manifest.json entries include `implementation_status` (stub/partial/complete) filled by programmatic scanning, not LLM self-report
  3. After each stage, feature coverage is checked against PRD feature list and gaps are reported
  4. Validator produces a summary report aggregating per-stage quality results into a full-pipeline integrity assessment
**Plans:** 3 plans
Plans:
- [ ] 09-01-PLAN.md — Types, manifest schema extensions, AST stub detection hook
- [ ] 09-02-PLAN.md — Hook registration, feature coverage check, Coder manifest integration
- [ ] 09-03-PLAN.md — Validator quality gate aggregation

### Phase 10: Test Fix Loop Intelligence
**Goal**: The Tester-Coder fix loop correctly diagnoses why tests fail and stops wasting rounds on unfixable infrastructure errors
**Depends on**: Phase 9
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Before running vitest, test files pass `tsc --noEmit` -- parse/import failures are caught before the test runner executes
  2. Test failures are classified into three categories (parse/import error, assertion failure, runtime error) visible in fix loop logs
  3. Fix loop terminates early when identical failure sets repeat for 2 consecutive rounds, producing a stagnation report
  4. Error type drives fix strategy: parse/import errors trigger config/dependency fixes, assertion errors trigger logic fixes
**Plans**: TBD

### Phase 11: Cost Tracking & Optimization
**Goal**: Pipeline runs report per-stage token costs, and UI Designer runs faster without degrading P0/P1 component quality
**Depends on**: Phase 10
**Requirements**: COST-01, COST-02, COST-03
**Success Criteria** (what must be TRUE):
  1. After a pipeline run, `run-metrics.json` contains per-stage token consumption (input/output) and CLI progress shows cumulative cost
  2. UI Designer components are tagged by priority (P0/P1/P2); P2 components skip full LLM implementation while P0/P1 retain full quality
  3. AnthropicSDK provider sets `cache_control` on shared context blocks, and cached token counts appear in run metrics
**Plans**: TBD

### Phase 12: Intent & Research Enrichment
**Goal**: The pipeline front-end produces richer, more grounded inputs for downstream agents
**Depends on**: Phase 8
**Requirements**: INTENT-01, INTENT-02
**Success Criteria** (what must be TRUE):
  1. Researcher executes real web searches via Anthropic `web_search` server tool and includes cited URLs in research.md
  2. IntentConsultant outputs a structured user profile (target demographics, devices, usage patterns, core pain points) in intent-brief.json
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10 -> 11 -> 12
(Phase 12 depends on Phase 8 only -- can run after Phase 8 if needed)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Test Infrastructure | v1.0 | 3/3 | Complete | 2026-03-26 |
| 2. Foundation Layer | v1.0 | 4/4 | Complete | 2026-03-27 |
| 3. Execution Engine | v1.0 | 3/3 | Complete | 2026-03-27 |
| 4. Coder Decomposition | v1.0 | 3/3 | Complete | 2026-03-27 |
| 5. Orchestrator Facade | v1.0 | 3/3 | Complete | 2026-03-27 |
| 6. Integration Wiring | v1.0 | 2/2 | Complete | 2026-03-27 |
| 7. README | v1.0 | 1/1 | Complete | 2026-03-27 |
| 8. Agent Architecture Fixes | v1.1 | 0/3 | Planning | - |
| 9. Quality Gate Infrastructure | v1.1 | 0/3 | Planning | - |
| 10. Test Fix Loop Intelligence | v1.1 | 0/? | Not started | - |
| 11. Cost Tracking & Optimization | v1.1 | 0/? | Not started | - |
| 12. Intent & Research Enrichment | v1.1 | 0/? | Not started | - |
