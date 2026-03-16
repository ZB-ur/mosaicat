# Mosaicat

The reference implementation of **AID (Autonomous Iterative Delivery)** — a methodology for AI-coding-enabled software delivery.

## What is AID?

Traditional delivery methodologies (Scrum, Kanban, DevOps) optimize **human execution efficiency**. In the AI coding era, execution shifts from humans to AI agents, and the bottleneck moves from execution to **decision-making**.

AID optimizes decision efficiency: humans define intent and validate results, AI agents autonomously deliver everything in between.

### Three Principles

| Principle | What it means |
|---|---|
| **Intent-first** | Clarify requirements before execution to reduce rework |
| **Autonomous execution** | AI completes the full process; humans only review at key checkpoints |
| **Experience accumulation** | Each iteration's learnings are captured as prompts and skills |

## What is Mosaicat?

Mosaicat is an autonomous AI Agent framework that integrates with LLMs via MCP protocol. One instruction in, full project delivery out — from idea to UI design and API specification.

Instead of replacing human roles, it augments them — AI agents handle research, analysis, and drafting while humans (designers, product owners) make the real decisions at key checkpoints.

```
User: "Build a blog system"
    ↓
Researcher       → Market research + feasibility report     [may clarify]
ProductOwner     → Structured PRD
UXDesigner       → Interaction flows + component inventory  [may clarify]
APIDesigner      → OpenAPI 3.0 specification                [may clarify]
UIDesigner       → React components + visual screenshots
Validator        → Cross-artifact consistency check
    ↓
Deliverables ready for human review
```

## Key Differentiators

| | Others (MetaGPT, CrewAI, etc.) | Mosaicat |
|---|---|---|
| Methodology | None, pure tooling | **AID methodology** with reference implementation |
| Integration | Standalone app | MCP protocol, works inside Claude Code |
| Intent handling | Execute as-is | **Agent-level intent clarification** before execution |
| Design Output | Text/code only | React components + Playwright screenshots |
| Quality | None/basic | **Validator + manifest** cross-artifact consistency check |
| Agent Communication | In-memory, untraceable | Git Issue driven, auditable |
| Setup | API Key required | Claude subscription only, zero config |
| Human Involvement | All-or-nothing | Configurable approval gates per stage |
| Context Management | Full history passed around | Artifact-isolated, precise token control |
| Self-evolution | Static prompts | **Prompt + Skill dual-track evolution** (human-approved) |
| Traceability | None/basic logs | **Layered logging system** for per-run retrospectives |

## Architecture

```
┌─ MCP Layer ──────────────────┐  ← Claude Code / LLM client
│ Trigger / Monitor / Approve  │
├─ Autonomous Engine ──────────┤  ← Core
│ Pipeline State Machine       │
│ Local Event Bus              │
│ Git Issue Persistence        │
│ Layered Logging              │
├─ Agent Layer ────────────────┤
│ 6 Agents (MVP)               │
│ Artifact-isolated context    │
│ Intent clarification         │
├─ Infrastructure ─────────────┤
│ Snapshots / SQLite / CLI LLM │
│ Skill Manager / Evolution    │
└──────────────────────────────┘
```

## MVP Scope

6 agents across Product, Design, and Quality:

| Agent | Input | Output | Clarification | Gate |
|---|---|---|---|---|
| Researcher | User instruction | `research.md` + manifest | Yes | auto |
| ProductOwner | User instruction + `research.md` | `prd.md` + manifest | No | manual |
| UXDesigner | `prd.md` | `ux-flows.md` + manifest | Yes | auto |
| APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` + manifest | Yes | auto |
| UIDesigner | `prd.md` + `ux-flows.md` + `api-spec.yaml` | `components/` + `screenshots/` + manifest | No | manual |
| Validator | All manifests | `validation-report.md` | No | auto |

## Core Mechanisms

- **Artifact Isolation**: Each agent only sees its contracted input artifacts — no pipeline history, no other agents' reasoning
- **Intent Clarification**: Agents can ask clarifying questions before execution; results are appended to artifacts with `[source: user]` annotation
- **Manifest-based Validation**: Each artifact includes a structural manifest; Validator checks cross-artifact consistency using manifests only (~3k tokens vs ~50k for full artifacts)
- **Dual-track Self-evolution**: Agents evolve prompts (24h cooldown) and create reusable skills (no cooldown), with automatic universality assessment for skill sharing
- **Trust Hierarchy**: Only the project initiator (human) can trigger irreversible operations
- **Pipeline State Machine**: Supports `awaiting_clarification` and `awaiting_human` states; rejection rolls back to the previous stage
- **Snapshot per Stage**: Full rollback capability at stage boundaries
- **Layered Logging**: Pipeline / Agent / Clarification / Evolution logs per run for retrospectives

## Tech Stack

- TypeScript / Node.js
- `@modelcontextprotocol/sdk` — MCP integration
- `@anthropic-ai/sdk` — Anthropic API (recommended provider)
- `claude` CLI — LLM calls (zero API key, alternative provider)
- `@octokit/rest` — GitHub adapter
- React + Tailwind + Playwright — UI output + screenshots
- `better-sqlite3` — state persistence
- `eventemitter3` — local event bus
- `zod` — artifact validation
- `p-queue` — serial execution queue

## Quick Start

### CLI 模式

```bash
npm install

# 全自动运行（跳过手动审批）
npx tsx src/index.ts run "Build a blog system" --auto-approve

# 交互模式（在 ProductOwner / UIDesigner 阶段暂停审批）
npx tsx src/index.ts run "Build a blog system"
```

### MCP 模式（Claude Code 集成）

在 Claude Code 的 MCP 设置中添加：

```json
{
  "mcpServers": {
    "mosaicat": {
      "command": "npx",
      "args": ["tsx", "src/mcp-entry.ts"],
      "cwd": "/path/to/mosaicat"
    }
  }
}
```

然后在 Claude Code 中直接使用 `mosaic_run`、`mosaic_status`、`mosaic_approve`、`mosaic_artifacts` 四个工具。

产出位于 `.mosaic/artifacts/` 目录，包括 PRD、交互流程、API 规范、React 组件和截图。

## Documentation

- **[Playbook](docs/playbook.md)** — 完整实战指南，含旅游咨询平台演示

## Project Status

**Phase 3 — Complete**. Core capabilities:
- Pipeline state machine with 6 agents (Researcher → Validator)
- Artifact-isolated context management + manifest-based validation
- Three LLM providers: Anthropic SDK, Claude CLI, Stub
- MCP Server with 4 tools for Claude Code integration
- Playwright screenshot rendering for UI components
- Layered logging + stage snapshots + rollback

## License

MIT
