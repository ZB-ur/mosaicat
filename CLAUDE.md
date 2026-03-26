# Mosaicat — Project Guide

> 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。
> 完整规范：plan/mosaic-project-plan.md

---

## Pipeline（M5：design-only / full / frontend-only profile）

```
design-only: IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner → UIDesigner → Validator
full:        IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner → UIDesigner → TechLead → Coder → QALead → Tester → SecurityAuditor → Reviewer → Validator
```

| Agent | 输入 | 输出 | 澄清 | 门控 |
|---|---|---|---|---|
| IntentConsultant | 用户指令 | `intent-brief.json` | 多轮动态 | auto |
| Researcher | `intent-brief.json` | `research.md` + `research.manifest.json` | 开启 | auto |
| ProductOwner | `intent-brief.json` + `research.md` | `prd.md` + `prd.manifest.json` | 关闭 | manual |
| UXDesigner | `prd.md` | `ux-flows.md` + `ux-flows.manifest.json` | 开启 | auto |
| APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` + `api-spec.manifest.json` | 开启 | auto |
| UIDesigner | `prd.md` + `ux-flows.md` + `api-spec.yaml` | `components/` + `previews/` + `screenshots/` + `gallery.html` + `components.manifest.json` | 关闭 | manual |
| TechLead | `prd.md` + `ux-flows.md` + `api-spec.yaml` | `tech-spec.md` + `tech-spec.manifest.json` | 开启 | manual |
| Coder | `tech-spec.md` + `api-spec.yaml` | `code-plan.json` + `code/` + `code.manifest.json` | 关闭 | auto |
| QALead | `tech-spec.md` + `code.manifest.json` | `test-plan.md` + `test-plan.manifest.json` | 关闭 | auto |
| Tester | `test-plan.md` + `code/` | `tests/` + `test-report.md` + `test-report.manifest.json` | 关闭 | manual |
| SecurityAuditor | `code/` + `code.manifest.json` | `security-report.md` + `security-report.manifest.json` | 关闭 | auto |
| Reviewer | `tech-spec.md` + `code/` | `review-report.md` + `review.manifest.json` | 关闭 | manual |
| Validator | 所有 `*.manifest.json` | `validation-report.md` | 关闭 | auto |

---

## 设计原则 & 开发规范

- 工件隔离：Agent 只看契约内 Artifact，不看 pipeline 历史；Agent 间通信只通过磁盘文件，禁止内存传递
- 用户原始指令只传递到 ProductOwner 为止，下游唯一信息源是 `prd.md`
- 意图澄清：Agent 级可选，每次最多一轮，结果标注 `[source: user]`
- Validator 只消费 manifest（~3k token），不消费全量 Artifact
- 回退策略：固定回退上一阶段，每阶段最多重试 3 次
- 自进化需人工 approve，进化机制本身不可进化
- 使用 TypeScript 严格模式；所有 Artifact 结构用 zod schema 校验
- LLM 调用统一走 llm-provider 接口，不直接调用 CLI
- 每个 Agent 实现必须继承 Agent 基类；manifest 由基类自动生成，不手写
- 日志调用统一走 logger 模块

---

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript / Node.js |
| MCP SDK | @modelcontextprotocol/sdk |
| LLM 调用 (MVP) | Claude CLI (`claude -p` + tool use + 结构化输出) + PQueue 串行队列 |
| LLM 调用 | @anthropic-ai/sdk |
| CLI 交互 | @inquirer/prompts |
| Git 操作 | @octokit/rest |
| UI 输出 | React + Tailwind CSS + Playwright |
| 工件校验 | zod |
| 事件驱动 | eventemitter3 |
| 串行队列 | p-queue |

---

## 模块边界速查（改代码前先看这里）

### 冻结模块（FROZEN — 接口稳定，不需要改动）
| 模块 | 职责 | 关键导出 |
|------|------|----------|
| `core/pipeline.ts` | 状态机引擎 | `createPipelineRun()`, `transitionStage()` |
| `core/agent.ts` | Agent 基类 | `BaseAgent`, `StubAgent` |
| `core/artifact.ts` | 工件磁盘 I/O | `writeArtifact()`, `readArtifact()` |
| `core/logger.ts` | JSONL 日志 | `Logger` class |
| `core/snapshot.ts` | 阶段快照 | `createSnapshot()` |
| `adapters/types.ts` | Git 适配器接口 | `GitPlatformAdapter` interface, `PRRef`, Git Data API types |
| `core/screenshot-renderer.ts` | Playwright 截图渲染 | `renderScreenshots()`, `renderPreviewScreenshots()` |
| `core/git-publisher.ts` | Git PR 流程（纯 API） | Draft PR + 逐步 commit via GitHub API |
| `core/github-interaction-handler.ts` | PR Review 审批 | `GitHubInteractionHandler` |
| `adapters/github.ts` | GitHub 适配器 | `GitHubAdapter` |
| `auth/*` | 整个认证模块 | OAuth + Token + AuthStore |

### M3 已完成模块（M3 DONE — 已重写/新增，接口稳定）
| 模块 | 职责 | 状态 |
|------|------|------|
| `providers/claude-cli.ts` | Claude CLI 调用 | ✅ tool use + 结构化输出 |
| `core/llm-provider.ts` | LLM 接口定义 | ✅ allowedTools、jsonSchema |
| `core/prompt-assembler.ts` | Prompt 拼装 | ✅ 任务 + 上下文拼装 |
| `agents/llm-agent.ts` | Agent 模板基类 | ✅ 结构化输出 + getOutputSpec() |
| `core/event-bus.ts` | 事件总线 | ✅ 精简完成 |
| `core/cli-progress.ts` | 终端进度 | ✅ 15 stage 支持 |
| `core/orchestrator.ts` | 全局编排 | ✅ Profile + Intent Consultant + Tester→Coder 修复循环 + stage 级进化 |
| `index.ts` | CLI 入口 | ✅ --profile flag |
| `core/types.ts` | 全局类型 | ✅ 15 StageName + skipped + PipelineProfile + IntentBrief |
| `core/manifest.ts` | manifest 读写 | ✅ Feature ID + 全 Agent manifest schemas |
| `core/agent-factory.ts` | Agent 实例工厂 | ✅ 13 agents registered |
| `agents/intent-consultant.ts` | Intent Consultant | ✅ 多轮对话 |
| `agents/tech-lead.ts` | TechLead Agent | ✅ tech-spec 输出 |
| `agents/coder.ts` | Coder Agent | ✅ Planner/Builder 分离 + 编译反馈 + 磁盘复用 |
| `agents/code-plan-schema.ts` | CodePlan Zod schema | ✅ module 级构建计划 |
| `agents/qa-lead.ts` | QALead Agent | ✅ 测试计划生成 |
| `agents/tester.ts` | Tester Agent | ✅ 测试代码生成 + 执行 |
| `agents/security-auditor.ts` | SecurityAuditor Agent | ✅ 程序化扫描 + LLM 审查 |
| `agents/reviewer.ts` | Reviewer Agent | ✅ code vs spec 审查 |
| `evolution/engine.ts` | 进化引擎 | ✅ stage 级分析 |
| `evolution/skill-manager.ts` | Skill 管理 | ✅ SKILL.md 标准格式 |

### 活跃模块（ACTIVE — 可能需要修改）
| 模块 | 职责 | 改动场景 |
|------|------|----------|
| `core/context-manager.ts` | 上下文组装 | 新 Agent 上下文需求 |
| `core/interaction-handler.ts` | 用户交互抽象 | 新交互模式 |
| `core/run-manager.ts` | MCP 运行管理 | 新参数 |
| `mcp/tools.ts` | MCP 工具注册 | 新工具 |
| `agents/*.ts` | 具体 Agent | 优化调整 |
| `core/artifact-presenter.ts` | 产出链接格式化 | 新 Agent 链接 |
| `core/issue-manager.ts` | Issue 分层管理 | 新 Stage Issue |

### 跨模块依赖关系
```
CLI(index.ts) → resolveGitHubAuth() → TokenService → Backend(api.mosaicat.dev)
                    ↓
              Orchestrator → Pipeline(状态机)
                    ↓
              InteractionHandler → GitHub/CLI/Deferred
                    ↓
              AgentFactory → agents/* → LLMAgent → PromptAssembler
                    ↓
              ProviderFactory → providers/* → LLMProvider(接口)
                    ↓
              ContextManager → SkillManager(evolution)
                    ↓
              EventBus ← CLIProgress / MCP

Auth: resolveGitHubAuth() → AuthStore(~/.mosaicat/) + TokenService → Backend
MCP: server.ts → RunManager → Orchestrator
Evolution: Orchestrator(per-stage + post-run) → Engine → ProposalHandler
```

### 关键接口文件（理解模块间通信只需读这几个）
- `core/types.ts` — 全局类型：StageName, PipelineRun, PipelineConfig, Task, AgentContext, GateResult, ReviewComment
- `core/llm-provider.ts` — LLM 调用契约：LLMProvider interface, LLMResponse, LLMUsage
- `core/interaction-handler.ts` — 用户交互契约：InteractionHandler interface
- `adapters/types.ts` — Git 平台契约：GitPlatformAdapter interface
- `evolution/types.ts` — 进化域类型：EvolutionProposal, PromptVersion, SkillMetadata
- `auth/types.ts` — 认证域类型：AuthConfig, CachedAuth, InstallationInfo

---

## 项目路径（src/ 模块详见上方速查表）

```
src/{core,mcp,providers,adapters,agents,evolution,auth}/ + index.ts + mcp-entry.ts
backend/src/                     # Cloudflare Worker 后端（GitHub App 认证）
config/pipeline.yaml             # 流水线配置（阶段/门控/重试/安全/进化）
config/agents.yaml               # Agent 编排配置（输入/输出契约）
.claude/agents/mosaic/*.md       # Agent Prompt 定义（可进化）
.mosaic/artifacts/               # 当前 Pipeline 的工件产出（git ignored）
.mosaic/snapshots/               # 阶段快照
.mosaic/logs/                    # 运行日志
.mosaic/evolution/{prompts,skills/shared,skills/{agent-name}}/  # 进化数据
```

---

## ⛔ 强制开发工作流（MANDATORY — 违反会被 hook 阻断）

> **以下规则由 hooks 机械化强制执行。不是建议，是硬性约束。**

### 铁律：每个 Step 的生命周期

任何代码修改都必须在一个 Step 生命周期内完成。**没有例外。**

```
/start-step N M desc    ← 1. 先建 issue，拿到 issue 号
    ↓
写代码 + 测试           ← 2. 所有 commit 引用该 issue 号
    ↓
/complete-step <issue>  ← 3. 评论结果 + 关闭 issue
```

**禁止：**
- ❌ 写代码之前不建 step issue
- ❌ 一个 commit 跨多个 step（每个 step 独立 commit）
- ❌ 跳过 `/complete-step` 直接开始下一个 step
- ❌ commit message 不引用 issue 号（hook 会阻断 `git commit`）

### 铁律：每个 Phase 的生命周期

```
/start-phase N desc       ← 1. 建分支 + phase issue
    ↓
循环执行每个 Step          ← 2. 每个 step 走上面的生命周期
    ↓
/complete-phase <issue>   ← 3. push + 创建 PR + 关闭 phase issue
```

**禁止：**
- ❌ 在 main 分支直接 commit（hook 会阻断）
- ❌ Phase 结束不创建 PR
- ❌ Step issues 没关完就 `/complete-phase`

### Commit 规范

- 格式：`<type>: <description> (#<issue>)`
- type: feat / fix / refactor / test / docs / chore
- **issue 号必须出现在 commit message 中，否则被 hook 阻断**

### Hook 强制执行清单

| Hook | 事件 | 强制行为 |
|---|---|---|
| `validate-commit.sh` | PreToolUse(Bash) | 阻断无 issue 引用的 git commit；阻断在 main 上的直接 commit |
| `workflow-guard.sh` | Stop | 每次响应结束提醒：未关闭的 step issue、未提交的改动、未 push 的 commit |
| `session-context.sh` | UserPromptSubmit | 每次用户输入时注入当前 phase/step 状态 |
| `log-tool-use.sh` | PostToolUse | 记录所有工具调用到 JSONL |

### 决策文档化

- 重大操作前写 **Decision:** [做什么] — [为什么] — [替代方案]

### 会话日志

- PostToolUse hook 自动记录，无需手动干预
- 日志位于 `.mosaic/logs/sessions/`

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Mosaicat v2 — Core Engine Rewrite**

Mosaicat 是一个 AI 多 Agent 流水线系统：用户给一条指令，经过最多 13 个 Agent 串行处理，产出从需求文档到设计稿到 API 规范到完整代码的交付物。当前版本（v1）功能完整但积累了显著的架构债务和代码质量问题。本次重写聚焦核心引擎层和 Agent 实现层，保留稳定接口和领域资产。

**Core Value:** Pipeline 引擎的可靠性和可维护性 — 每个 Agent 的输入输出契约必须被严格执行，错误必须可见，状态必须可追踪。

### Constraints

- **Tech stack**: 保持 TypeScript / Node.js / ESM，不引入新语言或运行时
- **Compatibility**: 重写后的模块必须与保留模块的接口完全兼容（`types.ts` 是契约）
- **Testing**: 每个重写模块必须有对应的单元测试，关键路径（resume、build loop）必须有集成测试
- **Incremental**: 渐进式重写，每个 phase 交付后系统必须可运行
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - All source code (`src/`, `backend/src/`)
- YAML - Pipeline and agent configuration (`config/pipeline.yaml`, `config/agents.yaml`)
- Markdown - Agent prompt definitions (`.claude/agents/mosaic/*.md`)
## Runtime
- Node.js (ES2022 target, ESM modules via `"type": "module"`)
- Cloudflare Workers - Backend only (`backend/`)
- npm
- Lockfile: `package-lock.json` (present)
- Backend has separate `backend/package-lock.json`
## Frameworks
- `@modelcontextprotocol/sdk` ^1.27.1 - MCP server implementation (`src/mcp/server.ts`)
- `@anthropic-ai/sdk` ^0.78.0 - Direct Anthropic API calls (`src/providers/anthropic-sdk.ts`)
- Hono ^4.7.0 - Backend HTTP framework (`backend/src/index.ts`)
- Vitest ^4.1.0 - Test runner and assertions (`vitest.config.ts`)
- Playwright ^1.58.2 - Browser automation for component screenshots (`src/core/screenshot-renderer.ts`)
- TypeScript ^5.9.3 - Compilation (`tsc`)
- tsx ^4.21.0 - Direct TS execution for dev (`tsx src/index.ts`)
- Wrangler ^4.14.0 - Cloudflare Workers dev/deploy (backend only)
## Key Dependencies
- `zod` ^4.3.6 - Schema validation for all artifacts and manifests
- `p-queue` ^9.1.0 - Serial queue for Claude CLI calls (`src/providers/claude-cli.ts`)
- `@octokit/rest` ^22.0.1 - GitHub API client (`src/adapters/github.ts`)
- `@octokit/auth-app` ^8.2.0 - GitHub App authentication
- `eventemitter3` ^5.0.4 - Event bus for pipeline events (`src/core/event-bus.ts`)
- `js-yaml` ^4.1.1 - YAML config parsing (`config/*.yaml`)
- `@inquirer/prompts` ^8.3.2 - CLI interactive prompts
- `better-sqlite3` ^12.8.0 - SQLite database (local data storage)
## TypeScript Configuration
- `strict: true` - Full strict mode enabled
- `target: ES2022` - Modern JS output
- `module: NodeNext` / `moduleResolution: NodeNext` - Native ESM
- `declaration: true`, `declarationMap: true`, `sourceMap: true` - Full type output
- Root: `src/` -> Output: `dist/`
## Build & Run Commands
## LLM Provider Architecture
| Provider | File | Purpose |
|----------|------|---------|
| `ClaudeCLIProvider` | `src/providers/claude-cli.ts` | Spawns `claude -p` CLI with tool use support |
| `AnthropicSDKProvider` | `src/providers/anthropic-sdk.ts` | Direct Anthropic Messages API via SDK |
| `OpenAICompatibleProvider` | `src/providers/openai-compatible.ts` | Generic OpenAI-compatible endpoint (GPT-4o, Qwen, DeepSeek, Gemini, etc.) |
## Configuration Files
- `config/pipeline.yaml` - Stage definitions, profiles, gate settings, LLM provider pool
- `config/agents.yaml` - Agent input/output contracts, allowed tools, prompt file paths
- `config/mcp-servers.yaml` - MCP server configuration (currently uses built-in tools only)
- `tsconfig.json` - Main project compiler config
- `backend/tsconfig.json` - Backend-specific compiler config
- `vitest.config.ts` - Sequential test execution (`fileParallelism: false`)
## Platform Requirements
- Node.js (ES2022+ compatible, likely v18+)
- Claude CLI installed (for default `claude-cli` provider)
- Playwright browsers (auto-installed, for screenshot rendering)
- Cloudflare Workers runtime
- Wrangler CLI for deployment
- GitHub App credentials as Wrangler secrets
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Source files: `kebab-case.ts` (e.g., `src/core/event-bus.ts`, `src/core/llm-provider.ts`, `src/agents/ui-designer.ts`)
- Test files: `kebab-case.test.ts` co-located in `__tests__/` subdirectories (e.g., `src/core/__tests__/pipeline.test.ts`)
- Schema files: `kebab-case-schema.ts` (e.g., `src/agents/code-plan-schema.ts`, `src/agents/ui-plan-schema.ts`)
- Config files: `kebab-case.yaml` (e.g., `config/pipeline.yaml`, `config/agents.yaml`)
- PascalCase: `BaseAgent`, `Orchestrator`, `EventBus`, `CoderAgent`, `UIDesignerAgent`
- Agent classes end with `Agent`: `ResearcherAgent`, `ValidatorAgent`, `TechLeadAgent`
- Provider classes end with `Provider`: `AnthropicSDKProvider`, `StubProvider`, `RetryingProvider`
- camelCase: `createPipelineRun()`, `transitionStage()`, `buildContext()`, `assemblePrompt()`
- Factory functions use `create` prefix: `createAgent()`, `createProvider()`, `createSnapshot()`
- Boolean getters use `should`/`is`/`has`: `shouldAutoApprove()`, `isTrustedActor()`, `artifactExists()`
- Builder/assembler functions use `build`/`assemble`: `buildContext()`, `buildIssueBody()`, `assemblePrompt()`
- camelCase for locals and parameters: `runId`, `stageConfig`, `inputArtifacts`
- UPPER_SNAKE_CASE for module-level constants: `DEFAULT_STAGES`, `STAGE_NAMES`, `AUTO_FIX_RETRIES`, `PLANNER_BUDGET_USD`
- PascalCase for interfaces and type aliases: `PipelineRun`, `AgentContext`, `StageConfig`, `LLMCallOptions`
- Interfaces do NOT use `I` prefix: `LLMProvider` not `ILLMProvider`
- Zod schemas use PascalCase + `Schema` suffix: `PrdManifestSchema`, `CodePlanSchema`, `IntentBriefSchema`
- Corresponding types extracted via `z.infer<>` or manually defined interfaces
- snake_case strings: `'intent_consultant'`, `'product_owner'`, `'ux_designer'`, `'api_designer'`
- Defined as const tuple in `src/core/types.ts`: `STAGE_NAMES`
## Code Style
- No Prettier or ESLint config at project root (none detected)
- Indentation: 2 spaces (consistent across all files)
- Single quotes for strings
- Trailing commas in multi-line arrays/objects
- Semicolons required
- `strict: true` in `tsconfig.json`
- Target: ES2022, Module: NodeNext, ModuleResolution: NodeNext
- `declaration: true`, `declarationMap: true`, `sourceMap: true`
- No ESLint or Biome configuration at project level
- Code quality enforced via TypeScript strict mode + `tsc` compilation
- Git hooks enforce commit message format and workflow rules
## Import Organization
- Always use `node:` prefix for Node built-ins: `'node:fs'`, `'node:path'`, `'node:os'`
- Always use `.js` extension on relative imports (required by NodeNext module resolution)
- Use `type` keyword for type-only imports: `import type { StageName } from './types.js'`
- Separate `import type` from value imports even from the same module
- None. All imports use relative paths with `.js` extension.
## Error Handling
- Custom error classes extend `Error` with a `name` property:
- `ClarificationNeeded` extends `Error` as a signal class (thrown, caught by orchestrator): `src/core/types.ts`
- Error messages use template literals with descriptive context
- `instanceof Error` check before accessing `.message`: `err instanceof Error ? err.message : String(err)`
- Try/catch with re-throw pattern in `BaseAgent.execute()`: catch, log, then re-throw
## Logging
- All logging goes through `Logger` class, never `console.log` in production code
- Two log channels: `logger.pipeline(level, event, data?)` and `logger.agent(stage, level, event, data?)`
- Log levels: `'info' | 'warn' | 'error' | 'debug'`
- Event names use `namespace:action` format: `'agent:start'`, `'llm:call'`, `'hook:mandatory-failed'`
- Data parameter is always `Record<string, unknown>` (optional)
## Comments
- JSDoc `/** */` on exported classes, interfaces, and key functions
- Inline comments for non-obvious logic (e.g., `// Fallback: if JSON parsing fails...`)
- Section dividers with `// --- Section Name ---` pattern in type definition files
- Chinese comments used for domain descriptions in orchestrator (e.g., `'意图深挖'`)
- Used on exported functions and classes: `/** Append an entry to run-memory.md */`
- Not universally applied to every function; primarily on public API surfaces
## Function Design
- Use interfaces/types for complex parameter groups: `AgentContext`, `LLMCallOptions`
- Optional parameters use `?` suffix, not `| undefined`
- Unused parameters prefixed with `_`: `_prompt`, `_options`, `_outputSpec`
- Async functions return `Promise<void>` when they produce side effects (write artifacts)
- Factory functions return concrete types
- Functions that may fail throw errors (no Result/Either pattern)
## Module Design
- Named exports preferred over default exports
- One primary class/function per file
- Re-export barrel files exist: `src/agents/index.ts`
- `src/agents/index.ts` re-exports all agent classes
- Not used in other directories (core, evolution, etc.)
- `eventBus` exported as module-level singleton from `src/core/event-bus.ts`
- `baseDir`/`currentRunDir` as module-level state in `src/core/artifact.ts`
## Zod Schema Conventions
- All manifest data validated with Zod at write time
- Schemas defined adjacent to the I/O functions that use them
- Schema names: `{Entity}Schema` (e.g., `FeatureSchema`, `CodePlanSchema`)
- Type extraction: `z.infer<typeof Schema>` for derived types
## Event Bus Conventions
- Format: `namespace:action` — `'stage:start'`, `'agent:thinking'`, `'pipeline:complete'`
- Typed via `PipelineEvents` interface with explicit callback signatures
- Emit via `eventBus.emit('event', ...args)`, subscribe via `eventBus.on('event', handler)`
## Agent Implementation Pattern
- `BaseAgent` (abstract) -> `LLMAgent` (abstract, structured output) -> Simple agents
- `BaseAgent` (abstract) -> Complex agents (`UIDesignerAgent`, `CoderAgent`, `ValidatorAgent`)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Sequential multi-agent pipeline where each stage produces disk artifacts consumed by downstream stages
- Strict artifact isolation: agents only see contracted inputs defined in `config/agents.yaml`, never pipeline history
- Event-driven progress reporting via a typed EventBus singleton
- Dual interaction modes: CLI (interactive terminal) and MCP (programmatic via Model Context Protocol)
- Self-evolution subsystem that analyzes pipeline runs and proposes prompt/skill improvements
## Layers
- Purpose: Parse commands and bootstrap the Orchestrator
- Location: `src/index.ts`
- Contains: Command parsing (`run`, `resume`, `refine`, `evolve`, `login`, `logout`, `setup`), CLI flag handling, progress display attachment
- Depends on: `core/orchestrator.ts`, `core/cli-progress.ts`, `auth/*`
- Used by: End users via `mosaicat` CLI
- Purpose: Expose pipeline as MCP tools for programmatic access
- Location: `src/mcp-entry.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts`
- Contains: MCP server setup, tool registration (mosaic_run, mosaic_status, mosaic_approve, mosaic_reject, mosaic_clarify, mosaic_artifacts, etc.)
- Depends on: `core/run-manager.ts`, `core/orchestrator.ts`
- Used by: MCP clients (e.g., Claude Desktop)
- Purpose: Sequence agents through pipeline stages, handle gates/retries/evolution
- Location: `src/core/orchestrator.ts`
- Contains: `Orchestrator` class — the main coordination engine
- Depends on: `core/pipeline.ts` (state machine), `core/agent-factory.ts`, `core/context-manager.ts`, `core/event-bus.ts`, `core/artifact.ts`, `core/interaction-handler.ts`, `evolution/engine.ts`, `core/git-publisher.ts`
- Used by: CLI entry, MCP RunManager
- Purpose: Manage pipeline run state transitions with validation
- Location: `src/core/pipeline.ts`
- Contains: `createPipelineRun()`, `transitionStage()`, `shouldAutoApprove()`, `getNextStage()`, `getPreviousStage()`, `resetStageForResume()`
- Depends on: `core/types.ts`
- Used by: Orchestrator exclusively
- Key invariant: State transitions are validated against a whitelist (`VALID_TRANSITIONS`). Invalid transitions throw.
- Purpose: Implement per-stage logic — call LLM, parse output, write artifacts
- Location: `src/agents/*.ts`, `src/core/agent.ts`, `src/agents/llm-agent.ts`
- Contains: `BaseAgent` (abstract base with hook support), `LLMAgent` (structured JSON output via LLM), specialized agents (Coder, UIDesigner, IntentConsultant, etc.)
- Depends on: `core/llm-provider.ts`, `core/artifact.ts`, `core/manifest.ts`, `core/prompt-assembler.ts`
- Used by: Orchestrator via `core/agent-factory.ts`
- Purpose: Abstract LLM calls behind a uniform interface
- Location: `src/core/llm-provider.ts` (interface), `src/core/provider-factory.ts`, `src/providers/*.ts`
- Contains: `LLMProvider` interface, `ClaudeCLIProvider`, `AnthropicSDKProvider`, `OpenAICompatibleProvider`, `RetryingProvider` (decorator), `StubProvider` (testing)
- Depends on: External SDKs (`@anthropic-ai/sdk`, Claude CLI, OpenAI-compatible APIs)
- Used by: Agent layer
- Purpose: Read/write pipeline artifacts to disk
- Location: `src/core/artifact.ts`
- Contains: `writeArtifact()`, `readArtifact()`, `artifactExists()`, `initArtifactsDir()`, `findLatestRun()`, `loadFromRun()`
- Depends on: Node.js `fs`
- Used by: BaseAgent, ContextManager, Orchestrator, Resume module
- Key invariant: All artifacts scoped under `.mosaic/artifacts/{runId}/`
- Purpose: Build `AgentContext` from config + disk artifacts + skills
- Location: `src/core/context-manager.ts`
- Contains: `buildContext()` — loads system prompt from `.claude/agents/mosaic/{agent}.md`, injects constitution, loads contracted input artifacts, appends approved skills
- Depends on: `core/artifact.ts`, `evolution/skill-manager.ts`, `config/agents.yaml`
- Used by: Orchestrator
- Purpose: Handle human-in-the-loop gates and clarifications
- Location: `src/core/interaction-handler.ts`, `src/core/github-interaction-handler.ts`
- Contains: `InteractionHandler` interface, `CLIInteractionHandler` (terminal prompts), `DeferredInteractionHandler` (MCP async), `GitHubInteractionHandler` (PR-based approvals)
- Depends on: `@inquirer/prompts` (CLI mode), `adapters/github.ts` (GitHub mode)
- Used by: Orchestrator
- Purpose: Publish pipeline artifacts as GitHub PRs via API
- Location: `src/core/git-publisher.ts`, `src/core/pr-body-generator.ts`
- Contains: `GitPublisher` — creates branch, commits stage artifacts via Git Data API, publishes PR
- Depends on: `adapters/types.ts` (`GitPlatformAdapter` interface)
- Used by: Orchestrator (optional, GitHub mode only)
- Purpose: Analyze pipeline runs and propose prompt/skill improvements
- Location: `src/evolution/engine.ts`, `src/evolution/skill-manager.ts`, `src/evolution/prompt-versioning.ts`, `src/evolution/proposal-handler.ts`
- Contains: `EvolutionEngine` (LLM-based analysis), `SkillManager` (SKILL.md loading with trigger matching), prompt versioning (backup + rollback)
- Depends on: `core/llm-provider.ts`, `core/artifact.ts`
- Used by: Orchestrator (post-stage and post-run)
- Purpose: GitHub OAuth + token management for GitHub App mode
- Location: `src/auth/*.ts`
- Contains: `resolveGitHubAuth()`, `oauthDeviceFlow()`, `TokenService`, `AuthStore`
- Depends on: Backend at `api.mosaicat.dev` (Cloudflare Worker)
- Used by: CLI entry, RunManager
## Data Flow
```
```
- Pipeline state is a `PipelineRun` object with per-stage `StageStatus` (`idle` → `running` → `done`)
- State is persisted to `pipeline-state.json` after each stage for crash recovery
- Resume restores state, resets interrupted stages to `idle`, validates outputs exist on disk
- `--from <stage>` flag allows targeted reset of specific stage + all downstream
- `eventBus` (singleton `EventBus` in `core/event-bus.ts`) emits typed events at every lifecycle point
- `cli-progress.ts` subscribes to events for terminal progress display
- MCP tools subscribe for async status tracking
- Events are fire-and-forget, no return values
## Key Abstractions
- Purpose: Template method pattern for agent execution
- Files: `src/core/agent.ts`, `src/agents/llm-agent.ts`
- Pattern: `BaseAgent.execute()` runs pre-hooks → `run()` (abstract) → post-hooks. `LLMAgent` implements `run()` with structured JSON output via LLM. Agents override `getOutputSpec()` to declare artifacts/manifest.
- Purpose: Uniform interface for LLM calls across providers
- Files: `src/core/llm-provider.ts`, `src/providers/claude-cli.ts`, `src/providers/anthropic-sdk.ts`, `src/providers/openai-compatible.ts`
- Pattern: Strategy pattern. `RetryingProvider` wraps any provider as a decorator for automatic retries with exponential backoff.
- Purpose: Decouple human interaction from pipeline logic
- Files: `src/core/interaction-handler.ts`, `src/core/github-interaction-handler.ts`
- Pattern: Strategy pattern with three implementations: CLI (terminal prompts), Deferred (MCP async), GitHub (PR review comments)
- Purpose: Abstract Git platform operations (currently GitHub only)
- Files: `src/adapters/types.ts`, `src/adapters/github.ts`
- Pattern: Adapter pattern for future multi-platform support
- Purpose: Enforce valid stage transitions
- Files: `src/core/pipeline.ts`, `src/core/types.ts`
- Pattern: Finite state machine with explicit transition whitelist. States: `idle` → `running` → `awaiting_clarification`/`awaiting_human`/`done`/`failed`
## Entry Points
- Triggers: `npx mosaicat run|resume|refine|evolve|login|logout|setup`
- Responsibilities: Parse args, resolve auth, create Orchestrator, attach CLI progress, run pipeline
- Triggers: MCP client connects via stdio transport
- Responsibilities: Start MCP server, register tools, create RunManager
- Triggers: Called by CLI or RunManager
- Responsibilities: Pipeline execution loop, stage sequencing, gate handling, retry logic, Tester-Coder fix loop, evolution, Git publishing, state persistence
## Error Handling
- `ClarificationNeeded` exception class signals an agent needs user input — caught by Orchestrator, routed to InteractionHandler
- `HookFailedError` signals a mandatory hook failed — stage fails immediately
- Stage failures increment `retryCount`, reset to `idle` for retry up to `stageConfig.retry_max`
- Tester-Coder fix loop: progressive strategy — rounds 1-2 direct-fix, round 3 replan-failed-modules, rounds 4-5 full-history-fix
- `RetryingProvider` (`src/core/retrying-provider.ts`) handles transient LLM errors with exponential backoff
- Pipeline state saved on failure for resume
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
