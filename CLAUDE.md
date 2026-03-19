# Mosaicat — Project Guide

> 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。
> 完整规范：plan/mosaic-project-plan.md

---

## Pipeline（M3 目标：design-only / full profile）

```
design-only: IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner → UIDesigner → Validator
full:        IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner → UIDesigner → TechLead → Coder → Reviewer → Validator
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
| Coder | `tech-spec.md` + `api-spec.yaml` | `code/` + `code.manifest.json` | 关闭 | auto |
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
| `core/cli-progress.ts` | 终端进度 | ✅ 12 stage 支持 |
| `core/orchestrator.ts` | 全局编排 | ✅ Profile + Intent Consultant + stage 级进化 |
| `index.ts` | CLI 入口 | ✅ --profile flag |
| `core/types.ts` | 全局类型 | ✅ 12 StageName + skipped + PipelineProfile + IntentBrief |
| `core/manifest.ts` | manifest 读写 | ✅ Feature ID + TechSpec/Code/Review schemas |
| `core/agent-factory.ts` | Agent 实例工厂 | ✅ 10 agents registered |
| `agents/intent-consultant.ts` | Intent Consultant | ✅ 多轮对话 |
| `agents/tech-lead.ts` | TechLead Agent | ✅ tech-spec 输出 |
| `agents/coder.ts` | Coder Agent | ✅ 高自主 tool use |
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
