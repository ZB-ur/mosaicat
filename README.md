<p align="center">
  <!-- TODO: Replace with custom banner image (1200x400) -->
  <img src="https://img.shields.io/badge/🐱_Mosaicat-One_instruction._Ten_AI_agents._Validated.-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Mosaicat" width="600" />
</p>

<p align="center">
  <strong>Spec Coding — a spec-driven AI pipeline that turns a single instruction into<br/>layered specifications and validated code.</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
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
- **Validation is spec conformance** — 4 fully deterministic programmatic checks (zero LLM) + 4 LLM checks scoped to structural manifests (~1–2 KB each), replacing 50k-token full-artifact reviews.
- **Specs evolve across runs** — prompt evolution and skill capture turn each delivery into organizational specification knowledge — with human approval as the safety gate.

```
You:  "Build a personal finance tracker with income/expense logging and monthly reports"
       ↓
       10 AI agents run autonomously, humans approve at 4 checkpoints
       ↓
Out:  Research → PRD → UX Flows → OpenAPI Spec → 25 React Components + Screenshots
      → Tech Spec → Code → Code Review → 8-Check Validation Report
```

<!-- TODO: Add demo GIF or screenshot of pipeline terminal output here -->

### Key Features

- **Spec-driven pipeline** — intent → layered specifications (PRD → UX → API → tech spec) → code; each spec layer is the sole input contract for the next agent
- **10 autonomous agents** — mirrors a real product team: consultant, researcher, PM, UX/UI designers, architect, tech lead, coder, reviewer, validator
- **Multi-LLM support** — Claude, GPT-4o, Gemini, Qwen, Doubao, Kimi; run `mosaicat setup` to switch providers
- **Batch UI generation** — components grouped by category for 80%+ fewer LLM calls; API spec auto-trimmed per batch
- **Configurable approval gates** — full autonomy, full manual, or anything in between per stage
- **8 layered validation checks** — 4 programmatic (zero LLM, fully deterministic) + 4 LLM-assisted (scoped to lightweight manifests)
- **Feature ID traceability** — `F-001` traced from PRD → UX → API → Components; task-level (`T-NNN`) from tech spec → code
- **Visual design output** — React + Tailwind components with Playwright screenshots + HTML gallery
- **GitHub-native workflow** — Draft PR, stage issues, PR review approval gates — fits existing team processes
- **Self-evolution with human oversight** — prompt + skill accumulation, all proposals require approval
- **3 pipeline profiles** — `design-only` / `full` / `frontend-only`, auto-recommended by intent analysis
- **MCP compatible** — integrates with Claude Code as an external tool server

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **LLM Provider** | Default: Claude CLI (requires [Claude subscription](https://claude.ai/)). Or run `mosaicat setup` to configure: Anthropic API, GPT-4o, Gemini, Qwen, Doubao, Kimi. |
| **Playwright** (optional) | Required only for UI screenshot generation. Install with `npx playwright install chromium`. |
| **GitHub App** (optional) | Required only for `--github` mode. Install the [Mosaicat GitHub App](https://github.com/apps/mosaicat) on your target repository, then login via `npx tsx src/index.ts login`. |

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

### 3. GitHub Mode (team collaboration)

```bash
# 1. Install the Mosaicat GitHub App on your repo: https://github.com/apps/mosaicat
npx tsx src/index.ts login                                    # 2. one-time OAuth
npx tsx src/index.ts run "Build a task management app" --github  # 3. run in repo dir
```

Creates a Draft PR with stage issues. Team members approve via `/approve` comments on the PR.

### 4. MCP Mode (IDE integration)

```bash
npx tsx src/mcp-entry.ts                                      # start MCP server
```

Add to your Claude Code MCP config, then use `mosaic_run` tool inside the IDE.

### 5. With Self-Evolution

```bash
npx tsx src/index.ts run "Build a task management app" --evolve
```

After each stage, the evolution engine analyzes performance and proposes prompt improvements or new skills. All proposals require human approval.

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
    TL -->|"🔒"| C[Coder]
    C --> RV[Reviewer]
    RV -->|"🔒"| V[Validator]

    style PO fill:#e8b4cb,stroke:#333,color:#000
    style UI fill:#e8b4cb,stroke:#333,color:#000
    style TL fill:#e8b4cb,stroke:#333,color:#000
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
| 8 | **Coder** | tech spec + API spec | `code/` + manifest | auto |
| 9 | **Reviewer** | tech spec + code | `review-report.md` + manifest | **manual** |
| 10 | **Validator** | all manifests | `validation-report.md` (8 checks) | auto |

### Manifests and Spec Conformance

Each agent emits a **manifest** (~1–2 KB) declaring structural facts: which Feature IDs it covered, which files it produced. The Validator runs **8 layered checks** — 4 programmatic (set intersection, file existence — zero LLM) + 4 LLM-assisted (scoped to manifests, not full artifacts). This is spec conformance at scale: you verify that each specification layer is structurally consistent with the others, without trusting another AI to judge quality.

---

## Pipeline Profiles

| Profile | Stages | Use Case |
|---|---|---|
| `design-only` | Intent → Research → PRD → UX → API → UI → Validate | Product specification, design review |
| `full` | All 10 agents | End-to-end: idea → validated code |
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

<!-- TODO: Add real screenshots of GitHub PR workflow -->

</details>

---

## Comparison

| Capability | Mosaicat | MetaGPT | CrewAI | v0 / bolt.new | Cursor / Windsurf |
|---|:---:|:---:|:---:|:---:|:---:|
| Spec-driven pipeline | ✅ Layered specs → code | ❌ | ❌ | ❌ | ❌ |
| Full pipeline (idea → code) | ✅ 10 agents | ✅ | ✅ | ❌ UI only | ❌ Code only |
| Spec conformance validation | ✅ 8 checks | ❌ | ❌ | ❌ | ❌ |
| Feature ID traceability | ✅ F-NNN end-to-end | ❌ | ❌ | ❌ | ❌ |
| Configurable approval gates | ✅ Per-stage | ❌ | ❌ | ❌ | ❌ |
| GitHub-native workflow | ✅ PR + Issues | ❌ | ❌ | ❌ | ❌ |
| Visual design output | ✅ React + Playwright | ❌ | ❌ | ✅ | ❌ |
| Self-evolution | ✅ Human-approved | ❌ | ❌ | ❌ | ❌ |
| Spec isolation | ✅ Strict contracts | ❌ Shared memory | ❌ Shared memory | N/A | N/A |
| Auth requirement | Claude subscription | API key | API key | Subscription | Subscription |

---

## Design Principles

### Spec Coding: Specifications as First-Class Artifacts

> The pipeline doesn't start by generating code. It generates a chain of increasingly detailed specifications — PRD → UX flows → API spec → tech spec — and derives code as the final step. Each specification is the sole input contract for the next agent.

This is the core architectural decision: when AI handles execution, the valuable artifacts are specifications, not implementations. Every other design principle follows from this:

- **Spec isolation** exists because spec boundaries must be strict — an agent reading a spec should not be influenced by how it was produced.
- **Manifest-based validation** works because specs have verifiable structural properties (feature coverage, endpoint mapping, file existence) that don't require LLM judgment.
- **Approval gates** are placed at spec transitions — the four points where a human reviews a specification before the next layer derives from it.

### Contracts, Not Conversations

> Multi-agent failures rarely come from dumb agents. They come from agents sharing too much context — errors correlate and propagate. The fix isn't smarter agents. It's stricter spec boundaries.

Each agent sees only its contracted spec inputs, never upstream reasoning. The UXDesigner reads the PRD but doesn't know why the Researcher excluded a competitor. This is not a limitation; it is the architecture. Errors stay local. Each agent brings fresh judgment.

Each agent emits a ~1–2 KB manifest declaring structural facts. The Validator runs 8 layered checks — 4 programmatic (zero LLM) + 4 LLM-assisted (scoped to manifests). This scales to enterprise pipelines where you cannot afford probabilistic quality gates.

### Autonomy With Guardrails

Agents are fully autonomous within their scope — they can use tools, spawn sub-agents, search the web. But autonomy is bounded by configurable constraints:

| Constraint | Configuration | Example |
|---|---|---|
| **Allowed tools** | `config/agents.yaml` | Coder: `[Read, Write, Bash, Agent, WebSearch]` |
| **Writable paths** | `config/agents.yaml` | Coder: `.mosaic/artifacts/code/` only |
| **Max turns** | `config/agents.yaml` | Researcher: 3, Coder: 10 |
| **Approval gates** | `config/pipeline.yaml` | ProductOwner: manual, Researcher: auto |

Full autonomy with production-grade guardrails. No all-or-nothing choice.

### From Execution Speed to Decision Speed

Traditional delivery methodologies (Scrum, Kanban) optimize human execution speed. When AI handles execution, the bottleneck shifts to human decision speed. Mosaicat places human decisions at spec transitions — the four points where one specification layer is approved before the next derives from it:

- **PRD approval** — is the problem spec correct?
- **Design review** — does the UX/UI spec match intent?
- **Tech spec sign-off** — is the architecture spec sound?
- **Code review** — does the implementation conform to its spec?

Everything between these spec approvals runs autonomously. This mirrors how senior engineering organizations already work — the pipeline just removes the manual execution between spec sign-offs.

### Self-Evolution: Specification Knowledge That Grows

Each pipeline run can improve the system. The evolution engine proposes:

- **Prompt evolution** — improved agent system prompts based on run outcomes (24h cooldown between versions)
- **Skill capture** — reusable domain knowledge saved as `SKILL.md` files, shared across agents or agent-specific

Critical safety constraints:
- All proposals require **human approval** before taking effect
- The evolution mechanism itself **cannot evolve** — a deliberate invariant
- Skills follow the open [Agent Skills standard](https://github.com/anthropics/agent-skills) format

Over time, the pipeline accumulates organizational knowledge: naming conventions, API patterns, design preferences, domain-specific heuristics. This knowledge persists across team members and survives personnel changes — it lives in the system, not in people's heads.

<details>
<summary>Skill directory structure</summary>

```
.mosaic/evolution/skills/
├── shared/              # Cross-agent skills (e.g., API naming conventions)
│   └── api-naming/
│       └── SKILL.md
└── ux-designer/         # Agent-specific skills (e.g., mobile-first patterns)
    └── mobile-first/
        └── SKILL.md
```

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
    end

    subgraph Agents["Agent Layer — 10 Agents"]
        direction LR
        A1["IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner"]
        A2["UIDesigner → TechLead → Coder → Reviewer → Validator"]
    end

    subgraph Infra["Infrastructure"]
        Provider["LLM Provider — Claude CLI / Anthropic SDK / OpenAI-Compatible (GPT, Gemini, Qwen, Doubao, Kimi)"]
        Git["Git Publisher — GitHub Data API"]
        Artifacts["Artifact I/O — Per-run isolated"]
        Evolution["Evolution Engine — Prompt + Skill"]
    end

    MCPServer --> Orch
    Orch --> Pipeline
    Orch --> EventBus
    Orch --> CtxMgr
    Pipeline --> Agents
    Agents --> Provider
    Agents --> Artifacts
    Git --> Orch
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
├── code/                          # Generated source code
├── review-report.md               # Code vs spec compliance review
├── validation-report.md           # 8-check cross-artifact validation
└── *.manifest.json                # Structural declarations per agent
```

<!-- TODO: Add sample screenshots from a real pipeline run -->

---

## Roadmap

| Milestone | Status | Highlights |
|---|---|---|
| **M1** — MVP Pipeline | ✅ Done | 6 agents, state machine, CLI provider |
| **M2** — Observability + Delivery | ✅ Done | GitHub mode, screenshots, logging |
| **M3** — Idea to Code | ✅ Done | 10 agents, 3 profiles, Feature ID, self-evolution |
| **M4** — Optimization + Multi-LLM | ✅ Done | Batch UI generation (86% fewer calls), 7 LLM providers, setup wizard, artifact isolation |
| **M5** — Quality + Scale | Planned | QA team agents, DAG engine, per-agent LLM routing, brownfield project support |

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
