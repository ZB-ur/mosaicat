# Mosaicat

An autonomous AI Agent framework that integrates with LLMs via MCP protocol. One instruction in, full project delivery out — from idea to UI design and API specification, powered by a self-evolving multi-agent pipeline.

## What is Mosaicat?

Mosaicat defines a new AI-coding-enabled delivery model. Instead of replacing human roles, it augments them — AI agents handle research, analysis, and drafting while humans (designers, product owners) make the real decisions at key checkpoints.

```
User: "Build a blog system"
    ↓
Researcher       → Market research + feasibility report
ProductOwner     → Structured PRD
UXDesigner       → Interaction flows + component inventory
UIDesigner       → React components + visual screenshots
APIDesigner      → OpenAPI 3.0 specification
    ↓
Deliverables ready for human review
```

## Key Differentiators

| | Others (MetaGPT, CrewAI, etc.) | Mosaicat |
|---|---|---|
| Integration | Standalone app | MCP protocol, works inside Claude Code |
| Design Output | Text/code only | React components + Playwright screenshots |
| Agent Communication | In-memory, untraceable | Git Issue driven, auditable |
| Setup | API Key required | Claude subscription only, zero config |
| Human Involvement | All-or-nothing | Configurable approval gates per stage |
| Context Management | Full history passed around | Artifact-isolated, precise token control |
| Self-evolution | Static prompts | Agents evolve prompts based on experience (human-approved) |

## Architecture

```
┌─ MCP Layer ──────────────────┐  ← Claude Code / LLM client
│ Trigger / Monitor / Approve  │
├─ Autonomous Engine ──────────┤  ← Core
│ Pipeline State Machine       │
│ Local Event Bus              │
│ Git Issue Persistence        │
├─ Agent Layer ────────────────┤
│ 5 Agents (MVP)               │
│ Artifact-isolated context    │
├─ Infrastructure ─────────────┤
│ Snapshots / SQLite / CLI LLM │
└──────────────────────────────┘
```

## MVP Scope

5 agents across Product and Design teams:

| Agent | Input | Output |
|---|---|---|
| Researcher | User instruction | `research.md` |
| ProductOwner | User instruction + `research.md` | `prd.md` |
| UXDesigner | `prd.md` | `ux-flows.md` |
| UIDesigner | `prd.md` + `ux-flows.md` | `components/` + `screenshots/` |
| APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` |

## Core Principles

- **Artifact Isolation**: Each agent only sees its contracted input artifacts — no pipeline history, no other agents' reasoning
- **Trust Hierarchy**: Only the project initiator (human) can trigger irreversible operations
- **Linear Pipeline**: Agents run sequentially; rejection rolls back to the previous stage
- **Snapshot per Stage**: Full rollback capability at stage boundaries

## Tech Stack

- TypeScript / Node.js
- `@modelcontextprotocol/sdk` — MCP integration
- `claude` CLI — LLM calls (zero API key)
- `@octokit/rest` — GitHub adapter
- React + Tailwind + Playwright — UI output
- `better-sqlite3` — state persistence
- `eventemitter3` — local event bus
- `zod` — artifact validation
- `p-queue` — serial execution queue

## Usage (Planned)

```bash
# Start a project
mosaicat run "Build a blog system with user auth and markdown editor"

# Check progress
mosaicat status

# Approve a stage
mosaicat approve design
```

## Project Status

🚧 **Phase 1 — In Progress**: Building core engine (pipeline state machine, agent base class, CLI provider, event bus)

## License

MIT
