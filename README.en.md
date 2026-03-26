<p align="center">
  <!-- TODO: Replace with custom banner image (1200x400) -->
  <img src="https://img.shields.io/badge/🐱_Mosaicat-One_instruction._Thirteen_AI_agents._Acceptance_driven.-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Mosaicat" width="600" />
</p>

<p align="center">
  <strong>Spec Coding — a spec-driven AI pipeline that turns a single instruction into<br/>layered specifications and acceptance-tested code.</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="#prerequisites">Prerequisites</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#comparison">Comparison</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%3E%3D18-339933.svg?logo=node.js&logoColor=white" alt="Node >= 18" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Compatible-8A2BE2.svg" alt="MCP Compatible" /></a>
</p>

---

## Why Mosaicat?

Traditional software delivery methodologies — Scrum, Kanban, SAFe — were designed to optimize **human execution efficiency**. In the AI era, execution shifts from humans to agents, and the bottleneck moves to **human decision efficiency**: are we building the right thing? Does the design make sense?

Mosaicat introduces **Spec Coding** — a delivery model where humans write and approve specifications, not code. The pipeline generates layered specs (PRD → UX flows → API spec → tech spec), each constraining the next agent. Code is the final derivative. Validation checks cross-spec conformance, not code quality.

- **Humans approve specs** at four critical checkpoints (PRD, design, architecture, code review). Everything between runs autonomously.
- **Spec boundaries isolate errors** — each agent sees only its upstream spec, never the reasoning behind it. Errors stay local instead of propagating through shared context.
- **Acceptance-driven completion** — "it compiles" is not done; "acceptance tests pass" is done. QALead derives tests from PRD features first, Coder targets passing them.
- **6 immutable constitution articles** — all agents share the same quality floor, auto-injected via BaseAgent hooks. Violations are blocked, not suggested.
- **Resilience first** — infinite LLM retry with exponential backoff + Stage Resume crash recovery. Long runs no longer fail catastrophically on transient errors.

```
You:  "Build a personal finance tracker with income/expense logging and monthly reports"
       ↓
       13 AI agents run autonomously, humans approve at 4 checkpoints
       ↓
Out:  Research → PRD → UX Flows → OpenAPI Spec → 25 React Components + Screenshots
      → Tech Spec → Acceptance Tests → Code → Test Execution → Security Audit → Code Review → 8-Check Validation Report
```

<!-- TODO: Add demo GIF or screenshot of pipeline terminal output here -->

### Key Features

- **Spec-driven pipeline** — intent → layered specifications (PRD → UX → API → tech spec) → code; each spec layer is the sole input contract for the next agent
- **13 autonomous agents** — mirrors a real product team: consultant, researcher, PM, UX/UI designers, architect, tech lead, QA lead, coder, tester, security auditor, reviewer, validator
- **Acceptance TDD** — QALead derives acceptance tests from PRD → Coder targets passing them → Tester executes; 5-round progressive fix loop (direct-fix → replan → full-history)
- **Agent Constitution** — 6 immutable quality articles (Verifiability First / Spec Is Authority / No Placeholder / Acceptance-Driven / Traceability / No Ambiguity), auto-injected via BaseAgent hooks
- **Crash recovery** — `mosaicat resume` continues from the breakpoint; `--from <stage>` lets you re-run from a specific stage (automatically cleans up that stage's and downstream artifacts)
- **Infinite LLM retry** — exponential backoff for transient errors (429, 503, network disconnects); only unrecoverable errors terminate
- **Skeleton-implement code generation** — skeleton phase writes all files with real imports/routes, implement phase fills in logic per module; compile-verified at every step
- **Integrated QA pipeline** — QALead generates acceptance tests, Tester executes, SecurityAuditor runs programmatic + LLM security audit; test failures auto-trigger Coder fixes
- **Build validation + smoke test** — static analysis on build artifacts (bundle size, placeholder detection) + HTTP smoke test
- **Post-delivery refinement** — `mosaicat refine` diagnoses and fixes issues in generated code with iterative feedback loop
- **Data-driven evolution** — `mosaicat evolve` analyzes retry-log failure patterns, LLM generates skill proposals, human approves interactively
- **Multi-LLM support** — Claude, OpenAI, Gemini, DeepSeek, Qwen, Doubao, Kimi, MiniMax; run `mosaicat setup` to switch providers
- **Batch UI generation** — components grouped by category for 80%+ fewer LLM calls; API spec auto-trimmed per batch
- **Configurable approval gates** — full autonomy, full manual, or anything in between per stage
- **8 layered validation checks** — 4 programmatic (zero LLM, fully deterministic) + 4 LLM-assisted (scoped to lightweight manifests)
- **Feature ID traceability** — `F-001` traced from PRD → UX → API → Tests → Code; task-level (`T-NNN`) from tech spec → code
- **Visual design output** — React + Tailwind components with Playwright screenshots + HTML gallery
- **GitHub-native workflow** — Draft PR, stage issues, PR review approval gates — fits existing team processes
- **3 pipeline profiles** — `design-only` / `full` / `frontend-only`, auto-recommended by intent analysis
- **MCP compatible** — integrates with Claude Code as an external tool server

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **LLM Provider** | Default: Claude CLI (requires [Claude subscription](https://claude.ai/)). Or run `mosaicat setup` to configure: Anthropic API, OpenAI, Gemini, DeepSeek, Qwen, Doubao, Kimi, MiniMax. |
| **Playwright** (optional) | Required only for UI screenshot generation. Install with `npx playwright install chromium`. |
| **GitHub App** (optional) | Required only for `--github` mode. Install the [Mosaicat GitHub App](https://github.com/apps/mosaicatie) on your target repository, then login via `npx tsx src/index.ts login`. |

> **Claude CLI users**: Claude Pro / Team / Enterprise plans work out of the box. The pipeline uses `claude -p` with tool use, no separate API key needed. For other providers, run `mosaicat setup` and enter your API key.

---

## Quick Start

```bash
git clone https://github.com/ZB-ur/mosaicat.git
cd mosaicat
npm install
```

### 0. Configure LLM (first time)

```bash
npx tsx src/index.ts setup
```

Interactive wizard: select provider → enter API key → test connection → done. Run again anytime to switch providers.

> Skip this step if using Claude CLI (default) — no configuration needed.

### 1. Basic Run

```bash
npx tsx src/index.ts run "Build a task management app"
```

The IntentConsultant asks clarifying questions, then the pipeline runs. Manual approval gates pause at ProductOwner, UIDesigner, TechLead, and Reviewer stages.

### 2. Auto-Approve (CI / rapid prototyping)

```bash
npx tsx src/index.ts run "Build a task management app" --auto-approve
```

### 3. Crash Recovery

```bash
npx tsx src/index.ts resume                     # resume the most recent interrupted run
npx tsx src/index.ts resume --run run-17743669   # resume a specific run
```

If a pipeline crashes mid-run (network drop, token limit, Ctrl+C), `resume` picks up from the last completed stage. Outputs from completed stages are preserved.

### 4. GitHub Mode (team collaboration)

**Step 1 — Install the GitHub App**

1. Visit [github.com/apps/mosaicatie](https://github.com/apps/mosaicatie) and click **Install**
2. Choose the account/organization to install on
3. Select **Only select repositories** and pick your target repo (recommended), or **All repositories**
4. Click **Install** — the App requests these permissions:
   - **Contents** (read & write) — commit artifacts to your repo
   - **Issues** (read & write) — create stage tracking issues
   - **Pull requests** (read & write) — create Draft PRs and manage review gates
   - **Metadata** (read-only) — required by GitHub

**Step 2 — Login & Run**

```bash
npx tsx src/index.ts login                                       # one-time OAuth (device flow)
npx tsx src/index.ts run "Build a task management app" --github  # run in your repo directory
```

The `login` command displays a one-time code — paste it at the GitHub verification page to authorize. Credentials are saved locally at `~/.mosaicat/auth.json`.

Creates a Draft PR with stage issues. Team members approve via `/approve` comments on the PR.

### 5. MCP Mode (IDE integration)

```bash
npx tsx src/mcp-entry.ts                                      # start MCP server
```

Add to your Claude Code MCP config, then use `mosaic_run` tool inside the IDE.

### 6. Refine Generated Code

```bash
npx tsx src/index.ts refine "the login button does nothing"
npx tsx src/index.ts refine "homepage is blank" --run run-1774194269016  # target a specific run
```

After a pipeline run, use `refine` to iteratively fix issues. The RefineAgent diagnoses the root cause, applies fixes, and verifies with `tsc` + build.

### 7. Data-Driven Evolution

```bash
npx tsx src/index.ts evolve
```

Analyzes retry-log failure patterns, LLM generates skill proposals, interactive approve/edit/reject. Skills are saved to `config/skills/builtin/` and automatically loaded in future runs.

---

## How It Works

```mermaid
graph LR
    IC[Intent<br/>Consultant] --> R[Researcher]
    R --> PO[Product<br/>Owner]
    PO -->|"🔒"| UX[UX<br/>Designer]
    UX --> API[API<br/>Designer]
    API --> UI[UI<br/>Designer]
    UI -->|"🔒"| TL[Tech<br/>Lead]
    TL -->|"🔒"| QA[QA<br/>Lead]
    QA --> C[Coder]
    C --> T[Tester]
    T -->|"fix loop ×5"| C
    T -->|"🔒"| SA[Security<br/>Auditor]
    SA --> RV[Reviewer]
    RV -->|"🔒"| V[Validator]

    style PO fill:#e8b4cb,stroke:#333,color:#000
    style UI fill:#e8b4cb,stroke:#333,color:#000
    style TL fill:#e8b4cb,stroke:#333,color:#000
    style T fill:#e8b4cb,stroke:#333,color:#000
    style RV fill:#e8b4cb,stroke:#333,color:#000
```

> 🔒 = configurable approval gate (manual by default). Set `--auto-approve` to skip, or configure per-stage in `config/pipeline.yaml`.

| # | Agent | Input | Output | Default Gate |
|---|---|---|---|---|
| 1 | **IntentConsultant** | User instruction | `intent-brief.json` | auto |
| 2 | **Researcher** | intent brief | `research.md` + manifest | auto |
| 3 | **ProductOwner** | intent brief + research | `prd.md` + manifest | **manual** |
| 4 | **UXDesigner** | PRD | `ux-flows.md` + manifest | auto |
| 5 | **APIDesigner** | PRD + UX flows | `api-spec.yaml` + manifest | auto |
| 6 | **UIDesigner** | PRD + UX + API spec | `components/` `screenshots/` `gallery.html` + manifest | **manual** |
| 7 | **TechLead** | PRD + UX + API spec | `tech-spec.md` + manifest | **manual** |
| 8 | **QALead** | tech spec + code manifest | `test-plan.md` + acceptance tests + manifest | auto |
| 9 | **Coder** | tech spec + API spec + acceptance tests | `code/` + manifest (skeleton → implement → build → smoke test) | auto |
| 10 | **Tester** | test plan + code | `test-report.md` + manifest (failures → Coder fix loop ×5) | **manual** |
| 11 | **SecurityAuditor** | code + code manifest | `security-report.md` + manifest | auto |
| 12 | **Reviewer** | tech spec + code | `review-report.md` + manifest | **manual** |
| 13 | **Validator** | all manifests | `validation-report.md` (8 checks) | auto |

### Constitution and Acceptance TDD

Every agent automatically inherits **6 immutable constitution articles** (injected via BaseAgent hooks), ensuring a unified quality floor. The two most critical:

- **Acceptance-Driven Completion** — code completion standard = acceptance tests pass. QALead derives executable tests from PRD features → Coder targets passing them → Tester verifies. 5-round progressive fix loop.
- **No Placeholder Delivery** — user-visible paths must not contain Placeholder / Coming Soon / TODO content.

### Manifests and Spec Conformance

Each agent emits a **manifest** (~1-2 KB) declaring structural facts: which Feature IDs it covered, which files it produced. The Validator runs **8 layered checks** — 4 programmatic (set intersection, file existence — zero LLM) + 4 LLM-assisted (scoped to manifests, not full artifacts).

---

## Pipeline Profiles

| Profile | Stages | Use Case |
|---|---|---|
| `design-only` | Intent → Research → PRD → UX → API → UI → Validate | Product specification, design review |
| `full` | All 13 agents (incl. acceptance TDD) | End-to-end: idea → acceptance-tested code |
| `frontend-only` | Skips APIDesigner | Frontend-focused projects |

```bash
npx tsx src/index.ts run "Build a blog" --profile design-only
```

The IntentConsultant auto-recommends a profile based on your instruction. Override with `--profile`.

---

## Usage Modes

| | CLI | GitHub | MCP |
|---|---|---|---|
| **Interface** | Terminal (inquirer) | PR + Issues | Claude Code |
| **Approval** | Interactive prompts | PR review comments | Tool responses |
| **Artifacts** | `.mosaic/artifacts/` | PR commits + local | `.mosaic/artifacts/` |
| **Best for** | Solo / rapid prototyping | Team collaboration | IDE integration |

<details>
<summary><strong>GitHub Mode — Detailed Flow</strong></summary>

```mermaid
sequenceDiagram
    participant U as User / Team
    participant M as Mosaicat
    participant GH as GitHub

    U->>M: run "Build X" --github
    M->>GH: Create Draft PR
    loop For each agent
        M->>GH: Create stage issue
        M->>M: Run agent
        M->>GH: Commit artifacts + close issue
        alt Manual gate
            M->>GH: Request PR review
            U->>GH: /approve or /reject (comment)
            GH->>M: Poll detects decision
        end
    end
    M->>GH: Mark PR ready for review
```

GitHub mode fits naturally into existing team workflows — designers review component screenshots on the PR, product owners approve PRDs through review comments, tech leads sign off on architecture. No new tools to learn.

</details>

---

## Comparison

| Capability | Mosaicat | MetaGPT | CrewAI | v0 / bolt.new | Cursor / Windsurf |
|---|:---:|:---:|:---:|:---:|:---:|
| Spec-driven pipeline | ✅ Layered specs → code | ❌ | ❌ | ❌ | ❌ |
| Full pipeline (idea → code) | ✅ 13 agents | ✅ | ✅ | ❌ UI only | ❌ Code only |
| Acceptance TDD | ✅ QALead → Coder → Tester | ❌ | ❌ | ❌ | ❌ |
| Quality constitution | ✅ 6 articles auto-injected | ❌ | ❌ | ❌ | ❌ |
| Crash recovery | ✅ Stage Resume | ❌ | ❌ | ❌ | ❌ |
| Spec conformance validation | ✅ 8 checks | ❌ | ❌ | ❌ | ❌ |
| Feature ID traceability | ✅ F-NNN end-to-end | ❌ | ❌ | ❌ | ❌ |
| Configurable approval gates | ✅ Per-stage | ❌ | ❌ | ❌ | ❌ |
| GitHub-native workflow | ✅ PR + Issues | ❌ | ❌ | ❌ | ❌ |
| Visual design output | ✅ React + Playwright | ❌ | ❌ | ✅ | ❌ |
| Data-driven evolution | ✅ retry-log → Skills | ❌ | ❌ | ❌ | ❌ |
| Integrated QA (test + security) | ✅ Auto test + audit | ❌ | ❌ | ❌ | ❌ |
| Post-delivery refinement | ✅ `refine` command | ❌ | ❌ | ❌ | ❌ |
| Infinite LLM retry | ✅ Exponential backoff | ❌ | ❌ | N/A | N/A |
| Spec isolation | ✅ Strict contracts | ❌ Shared memory | ❌ Shared memory | N/A | N/A |
| Auth requirement | Claude subscription | API key | API key | Subscription | Subscription |

---

## Design Principles

### Spec Coding: Specifications as First-Class Artifacts

> The pipeline doesn't start by generating code. It generates a chain of increasingly detailed specifications — PRD → UX flows → API spec → tech spec — and derives code as the final step. Each specification is the sole input contract for the next agent.

This is the core architectural decision: when AI handles execution, the valuable artifacts are specifications, not implementations. Every other design principle follows from this.

### Constitution: An Immutable Quality Floor

> 13 agents need a unified quality standard, but "unified" doesn't mean "copy-paste the same rules into 13 prompts."

The Mosaicat Static Constitution defines 6 immutable articles, auto-injected into every agent's system prompt via BaseAgent hooks. Violations are blocked by post-run checks. The constitution is not guidance — it is a hard constraint.

Core articles: acceptance tests must pass for completion (not just compilation); user-visible paths must not contain placeholder content; F-NNN traceability must not break end-to-end.

### Acceptance TDD: Define "Done" Before Writing Code

> Lesson from M6: testing after coding means expensive fix cycles. TDD gives Coder an explicit definition of "done."

QALead derives executable acceptance tests from PRD features → Coder targets passing them → Tester verifies. Failures trigger up to 5 progressive fix rounds (direct-fix → replan-failed-modules → full-history-fix). Each round accumulates context; strategy escalates with each attempt.

### Contracts, Not Conversations

> Multi-agent failures rarely come from dumb agents. They come from agents sharing too much context — errors correlate and propagate. The fix isn't smarter agents. It's stricter spec boundaries.

Each agent sees only its contracted spec inputs, never upstream reasoning. The UXDesigner reads the PRD but doesn't know why the Researcher excluded a competitor. This is not a limitation; it is the architecture.

### Resilience First: Long Runs Should Not Be Fragile

> A full pipeline may run 30+ minutes and consume significant tokens. Losing everything to a single 429 or network blip is unacceptable.

- **RetryingProvider** decorates all LLM providers with infinite exponential-backoff retry for transient errors (429, 503, network)
- **Stage Resume** persists state after every stage; `mosaicat resume` picks up from the breakpoint after a crash; `--from <stage>` supports targeted re-run with automatic downstream artifact cleanup
- **retry-log** persists all retry events, providing real data for `mosaicat evolve`

### Data-Driven Evolution

> M6's stage-level evolution called LLM after every stage, mostly filtered by cooldown. Cost exceeded benefit.

M7 switches to manual `mosaicat evolve`: based on retry-log real failure data (not manifest guesswork), aggregates high-frequency patterns, LLM generates skill proposals, human approves each one interactively. Data-driven > speculation-driven.

### From Execution Speed to Decision Speed

Traditional delivery methodologies (Scrum, Kanban) optimize human execution speed. When AI handles execution, the bottleneck shifts to human decision speed. Mosaicat places human decisions at spec transitions:

- **PRD approval** — is the problem spec correct?
- **Design review** — does the UX/UI spec match intent?
- **Tech spec sign-off** — is the architecture spec sound?
- **Code review** — does the implementation conform to its spec?

Everything between these spec approvals runs autonomously. This mirrors how senior engineering organizations already work — the pipeline just removes the manual execution between spec sign-offs.

<details>
<summary>Skill directory structure</summary>

```
config/skills/builtin/           # Built-in skills (version-controlled with codebase)
├── form-validation-zod/
│   └── SKILL.md
└── vitest-setup/
    └── SKILL.md

.mosaic/evolution/skills/        # Skills evolved from runtime data
├── shared/                      # Cross-agent skills
│   └── api-naming/
│       └── SKILL.md
└── ux-designer/                 # Agent-specific skills
    └── mobile-first/
        └── SKILL.md
```

Skills use progressive disclosure via trigger keywords: matching skills are fully loaded into prompts, non-matching skills show summaries only. Lifecycle managed via usage counts + deprecation markers.

</details>

---

## Architecture

```mermaid
graph TB
    subgraph MCP["MCP Layer"]
        MCPServer["MCP Server"]
        MCPTools["mosaic_run / mosaic_status / mosaic_approve"]
    end

    subgraph Engine["Autonomous Engine"]
        Orch["Orchestrator"]
        Pipeline["Pipeline State Machine"]
        EventBus["Event Bus"]
        CtxMgr["Context Manager"]
        Resume["Stage Resume"]
        RetryProv["RetryingProvider"]
    end

    subgraph Agents["Agent Layer — 13 Agents + Constitution"]
        direction LR
        Constitution["Constitution<br/>(6 Articles)"]
        A1["IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner"]
        A2["UIDesigner → TechLead → QALead → Coder → Tester → SecurityAuditor → Reviewer → Validator"]
    end

    subgraph Infra["Infrastructure"]
        Provider["LLM Provider — Claude CLI / Anthropic SDK / OpenAI-Compatible"]
        Git["Git Publisher — GitHub Data API"]
        Artifacts["Artifact I/O — Per-run isolated"]
        Evolution["Evolution — mosaicat evolve + Skill Manager"]
        RetryLog["retry-log.jsonl"]
    end

    MCPServer --> Orch
    Orch --> Pipeline
    Orch --> EventBus
    Orch --> CtxMgr
    Orch --> Resume
    Pipeline --> Agents
    Constitution --> Agents
    Agents --> RetryProv
    RetryProv --> Provider
    Agents --> Artifacts
    Git --> Orch
    Evolution --> RetryLog
    Evolution --> CtxMgr
```

---

## Outputs

Each run produces artifacts in an isolated directory:

```
.mosaic/artifacts/{run-id}/
├── intent-brief.json              # Structured intent from multi-turn dialogue
├── research.md                    # Market research + feasibility
├── prd.md                         # PRD with Feature IDs (F-001, F-002, ...)
├── ux-flows.md                    # Interaction flows + component inventory
├── api-spec.yaml                  # OpenAPI 3.0 specification
├── components/                    # 25+ React + Tailwind TSX components
├── previews/                      # Standalone HTML previews
├── screenshots/                   # Playwright-rendered PNGs
├── gallery.html                   # Visual gallery with embedded screenshots
├── tech-spec.md                   # Technical architecture + task breakdown
├── test-plan.md                   # QALead acceptance test plan
├── tests/acceptance/              # Executable acceptance tests (vitest)
├── code/                          # Generated source code (skeleton → implement → build)
├── code-plan.json                 # Module build plan with smoke test config
├── test-report.md                 # Tester execution results
├── security-report.md             # SecurityAuditor findings (programmatic + LLM)
├── review-report.md               # Code vs spec compliance review
├── validation-report.md           # 8-check cross-artifact validation
├── pipeline-state.json            # Pipeline state snapshot (for resume)
└── *.manifest.json                # Structural declarations per agent
```

---

## Roadmap

| Milestone | Status | Highlights |
|---|---|---|
| **M1** — MVP Pipeline | ✅ Done | 6 agents, state machine, CLI provider |
| **M2** — Observability + Delivery | ✅ Done | GitHub mode, screenshots, logging |
| **M3** — Idea to Code | ✅ Done | 10 agents, 3 profiles, Feature ID, self-evolution |
| **M6** — Optimization + Quality + QA | ✅ Done | Batch UI (86% fewer calls), 7 LLM providers, skeleton-implement Coder, QA team (13 agents), build smoke test, `refine` command |
| **M7** — Resilience + Constitution + Acceptance TDD | ✅ Done | 6 constitution articles, acceptance TDD, 5-round progressive fix, Stage Resume, infinite LLM retry, `evolve` command |
| **M8** — Scale + Enterprise | Planned | DAG execution engine, per-agent LLM routing, brownfield project support |

---

## Contributing

Contributions welcome. Please open an issue first to discuss what you'd like to change.

<!-- TODO: Add contributor wall via contrib.rocks when repo is public -->

---

## License

[MIT](LICENSE)

<!--
## Star History

TODO: Add star history chart when repo gains traction
[![Star History Chart](https://api.star-history.com/svg?repos=ZB-ur/mosaicat&type=Date)](https://star-history.com/#ZB-ur/mosaicat&Date)
-->
