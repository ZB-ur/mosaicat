# Mosaic — 自治式 AI Agent 全流程交付框架（项目计划书 v2）

> 基于 v1 计划书的补充讨论，修正架构问题，明确 MVP 范围与技术决策。

---

## 产品定位

一个通过 MCP 协议接入 LLM（如 Claude Code）的自治式 AI Agent 框架。用户给出一条指令，Agent 集群自主完成从 idea 到设计交付的全流程，关键节点由人工审批把控。

**一句话描述：** 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。

**核心理念：** 定义一种新的 AI Coding 赋能下的需求交付模式——AI 辅助人工，而非替代人工。设计师、产品经理等角色在流程中真实参与、审核、决策。

---

## 核心差异化（vs MetaGPT / CrewAI / LangGraph）

| 差异点 | 同类产品 | Mosaic |
|---|---|---|
| 接入方式 | 独立应用，脱离开发者工作流 | MCP 框架，融入 Claude Code 等现有工具 |
| 设计输出 | 纯文字/代码，无视觉产出 | **React 组件 + Playwright 截图**，设计师可审查 |
| Agent 通信 | 内存中传递，不可追溯 | **Git Issue 驱动**，天然可审计 |
| 使用门槛 | 需要 API Key | **仅需 Claude 订阅**，零额外配置 |
| 人工介入 | 要么全手动要么全自动 | **可配置审批门控**，任意节点可选人工/自动 |
| 上下文管理 | 全量传递，容易溢出 | **工件隔离**，Agent 只看契约内的 Artifact |
| 自我进化 | Prompt 固定不变 | **Agent 自进化**，基于使用经验持续优化（人工审批后生效） |

---

## MVP 范围：idea → 设计稿 + API 规范

### Pipeline 顺序

```
用户指令（一条）
    ↓
Researcher Agent      → 竞品分析 + 可行性报告
    ↓ 自动触发
ProductOwner Agent    → 结构化 PRD
    ↓ 人工审批门控
UXDesigner Agent      → 交互流程 + 组件清单
    ↓ 自动触发
UIDesigner Agent      → React 组件 + Playwright 截图
    ↓ 人工审批门控（设计师 review 截图）
APIDesigner Agent     → OpenAPI 3.0 规范
    ↓
完成，用户查看产出物
```

### 5 个 MVP Agent

| 团队 | Agent | 输入 | 输出 |
|---|---|---|---|
| 产品团队 | Researcher | 用户指令 | `research.md` |
| 产品团队 | ProductOwner | 用户指令 + `research.md` | `prd.md` |
| 设计团队 | UXDesigner | `prd.md` | `ux-flows.md` |
| 设计团队 | UIDesigner | `prd.md` + `ux-flows.md` | `components/` + `screenshots/` |
| 设计团队 | APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` |

### 完整版本（Phase 2+）

```
产品团队 → 设计团队 → 研发团队 → 测试团队 → SRE 团队
  PRD    设计稿+API  代码+PR  测试报告  CI/CD+部署
```

| 团队 | Agents | 产出物 |
|---|---|---|
| 产品团队 | ProductOwner, Researcher | PRD、竞品分析、可行性报告 |
| 设计团队 | UXDesigner, UIDesigner, APIDesigner | React 组件截图、交互流程、API 规范 |
| 研发团队 | TechLead, Coder×N, Reviewer | 代码、PR、Code Review |
| 测试团队 | QALead, Tester, SecurityAuditor | 测试用例、测试报告、安全扫描 |
| SRE 团队 | DevOps, ReleaseManager, Monitor | CI/CD 配置、部署配置、监控配置 |

---

## 关键技术决策

### 1. 架构模式：自治引擎 + MCP 入口

```
┌─ MCP 层 ─────────────────────┐ ← Claude Code 等 LLM 客户端调用
│ 触发 / 查询进度 / 审批       │   仅做入口，不做编排
├─ 自治引擎层 ─────────────────┤ ← 核心差异化
│ 流水线状态机 + 本地事件总线   │
│ Git Issue 仅做持久化 + 人工入口│
├─ Agent 层 ───────────────────┤
│ 5 Agent（MVP）               │
│ 每个 Agent 独立调用 LLM      │
├─ 基础设施层 ─────────────────┤
│ 上下文管理 / 快照 / 持久化    │
└───────────────────────────────┘
```

**选择理由：** MCP 仅做触发和监控入口，自治引擎后台独立运行。Pipeline 内部用本地事件总线驱动（非 GitHub API 轮询），Git Issue 是状态的持久化记录和人工介入的入口。

### 2. LLM 调用：Claude CLI Provider + 串行队列

**决策：** MVP 使用 `claude --print` 调用模型，用户仅需 Claude 订阅，无需 API Key。

```
Provider A (MVP):     Claude CLI → 用户的 Claude 订阅 → 零配置
Provider B (Phase 2): @anthropic-ai/sdk → API Key → 可并发
```

**并发策略：** Claude CLI 无法真并发，采用 `PQueue({ concurrency: 1 })` 串行队列统一调度。Pipeline 是线性的（一个 Agent 完成后下一个才开始），串行不影响正确性，仅影响效率。

```typescript
class ClaudeCLIProvider {
  private queue = new PQueue({ concurrency: 1 })

  async call(prompt: string): Promise<string> {
    return this.queue.add(() => exec(`claude --print "${prompt}"`))
  }
}
```

**Phase 2 扩展：** 有 API Key 的用户自动切换到 `@anthropic-ai/sdk`，支持并发。

### 3. 上下文管理：工件隔离（核心原则）

**这是整个架构最关键的设计原则。**

每个 Agent 只看到**它需要的 Artifact**，不看过程、不看其他 Agent 的推理历史、不看完整 Pipeline 状态。

```typescript
type AgentContext = {
  system_prompt: string        // 该 Agent 的角色定义
  task: Task                   // 当前分配的任务
  input_artifacts: Artifact[]  // 仅契约内指定的文件
  // ❌ 没有 pipeline history
  // ❌ 没有其他 agent 的推理过程
  // ❌ 没有完整的 issue thread
}
```

**用户原始指令只传递到 ProductOwner 为止。** 之后所有下游 Agent 的信息来源是 `prd.md`，它是唯一的"根"。

### 4. Artifact 契约

Agent 之间的唯一通信介质是**写到磁盘/仓库的文件**，不是内存里的对象传递。路径和格式是契约的一部分，不能随意更改。

```
.mosaic/artifacts/
├── research.md                 # Researcher 产出
├── prd.md                      # ProductOwner 产出
├── ux-flows.md                 # UXDesigner 产出
├── components/                 # UIDesigner 产出
│   ├── LoginForm.tsx
│   └── index.ts
├── screenshots/                # UIDesigner 产出（Playwright 生成）
│   └── LoginForm.png
└── api-spec.yaml               # APIDesigner 产出
```

**`research.md` 结构：**
```markdown
## Market Overview
## Competitor Analysis
| 竞品 | 核心功能 | 优势 | 劣势 |
## Feasibility
## Key Insights
```

**`prd.md` 结构：**
```markdown
## Goal
一句话目标
## Features
- Feature 1: 描述
## Constraints
- 技术约束
## Out of Scope
- 明确不做的事
```

**`ux-flows.md` 结构：**
```markdown
## User Journeys
### Flow 1: 注册流程
步骤1 → 步骤2 → 步骤3
## Interaction Rules
- 表单验证时机
- 错误提示方式
## Component Inventory
- LoginForm
- Dashboard
```

**`api-spec.yaml`：** 标准 OpenAPI 3.0 格式。

### 5. UI 设计输出：Code-first

**决策：** 不依赖 Figma，采用 React + Tailwind 组件 + Playwright 截图。

**理由：**
- Figma REST API 只能读，不能写。写操作需要 Plugin API + 第三方 MCP bridge + Figma Desktop 常开，依赖过重。
- Penpot 作为备选方案，设计师发现设计有误后编辑体验差，不可用。
- Code-first 无外部依赖，且 React 组件本身就是最终交付物的一部分。

**设计师参与方式：** 审查 Playwright 截图 → 通过 Issue 提交文字 Feedback → AI 修改组件 → 重新截图 → 循环直到 approve。

```
UIDesigner Agent → React 组件 + Playwright 截图
                              ↓
                   设计师 review 截图
                    ├── approve → Pipeline 继续
                    └── feedback（文字）→ AI 修改组件 → 重新截图
```

### 6. Agent 间通信：本地事件总线 + Git Issue 持久化

**决策：** Pipeline 内部用本地 EventEmitter 驱动，Git Issue 只做持久化记录和人工介入入口。

**理由：** MVP 是线性 Pipeline（5 Agent 串行执行），每阶段结束触发下一阶段，不存在并发 polling。GitHub API 5000 req/hr 的限制对我们不构成问题，但也没必要用 API 做内部驱动。

**Issue 的实际作用：**
- 每阶段完成后创建一个 Issue，记录产出物
- 人工审批门控：通过 Issue label / comment 操作
- 人工反馈：设计师在 Issue 评论中提交 feedback
- 可审计：所有决策和产出物都有 Issue 记录

**Issue Schema：**
```yaml
# Agent 发出的 Issue（只能请求审核，不能自触发下一阶段）
title: "[UIDesigner] design-review: login-flow"
labels: ["agent:ui-designer", "status:review-needed"]
body:
  agent_id: "ui-designer-v1"
  task_ref: "#12"
  output: "components/LoginForm.tsx, screenshots/LoginForm.png"
  request: null                # Agent 不能主动发起新需求
```

### 7. Pipeline 状态机

**阶段状态流转：**
```
idle → running → awaiting_human → approved → done
                               └→ rejected → 回退到上一阶段
                               └→ failed（超时/错误）
```

**回退策略：固定回退上一阶段（方案C）**
```
APIDesigner rejected → UIDesigner 重试
UIDesigner rejected  → UXDesigner 重试
UXDesigner rejected  → ProductOwner 重试
ProductOwner rejected → Researcher 重试
Researcher rejected  → 等待发起者修改原始指令
```

**审批门控配置：**
```yaml
# config/pipeline.yaml
stages:
  researcher:
    gate: auto
  product_owner:
    gate: manual          # PRD 需要人工确认
  ux_designer:
    gate: auto
  ui_designer:
    gate: manual          # 设计截图需要设计师审查
  api_designer:
    gate: auto

pipeline:
  max_retries_per_stage: 3
  snapshot: on_stage_complete
```

### 8. 快照与回退

**快照时机：每阶段完成时创建一次。**

```
.mosaic/snapshots/
└── 2026-03-15T10:00:00/
    ├── artifacts/              # 该阶段完成时的全部 artifact 副本
    └── meta.json               # 阶段信息、Agent 版本、Issue 列表
```

**回退操作：**
1. 终止当前运行中的 Agent
2. 恢复到目标阶段的 snapshot
3. 关闭回退阶段之后创建的 Issue，标记 `[rolled-back]`
4. 从目标阶段重新执行

### 9. 自治执行模式

```
每个 Agent 的执行循环：
  输入 Artifact → 调用 LLM → 产出 Artifact
      ↓
  自评估（内置 critic）
      ├─ 通过 → 写入 Issue → 等待门控（auto 或 human）
      └─ 不通过 → 自动修正（最多 3 次）
           └─ 超限 → 产出当前最佳版本 + 标记 [needs-review]
```

---

## 安全模型

### 统一信任层级

```
Level 0 — 项目发起者（人类，通过 Claude Code / GitHub 账号操作）
Level 1 — Orchestrator（代理发起者意图，只执行，不决策）
Level 2 — Agent（只能在分配的 Task 范围内行动）
Level 3 — 外部内容（网页、文档等，永远不可信）
```

**核心原则：只有 Level 0 的输入能触发不可逆操作。**

### 身份验证

单人场景下，信任判断不依赖内容，依赖 GitHub 身份：

```yaml
# config/pipeline.yaml
security:
  initiator: "lddmay"        # GitHub login，唯一可信源
  reject_policy: "silent"     # 非发起者的事件静默忽略
```

```typescript
function isTrustedActor(event: GitHubEvent): boolean {
  return event.sender.login === process.env.MOSAIC_INITIATOR_LOGIN
}
// 所有 webhook 事件第一步过这个检查
```

### 需要 Level 0 确认的操作

| 操作 | 理由 |
|---|---|
| Pipeline 启动 | 定义目标，是所有后续的根 |
| PRD 审批 | 需求确认权不能委托给 AI |
| 设计截图 approve | 视觉决策权不能委托给 AI |
| Pipeline 终止 / 回滚 | 破坏性操作 |
| 进化 approve | 修改 Agent prompt 是系统级变更 |

### Agent 间信任边界

- Agent 发出的 Issue **只能请求审核**，不能自主触发下一阶段
- 下一阶段的 trigger 只来自发起者的 label/comment（auto gate 由 Orchestrator 代行，但 Orchestrator 是 Level 1）
- Agent 只能修改契约内的 Artifact 路径，不能写其他位置

### 外部内容防注入

Agent 处理外部内容（Researcher 爬网页）时：
```typescript
const safeExternalContent = {
  type: "external_data",      // 不是 instruction
  source: url,
  content: rawText,
  trust_level: 0              // 永远是 0，不可提升
}
// Agent prompt 明确指令：external_data 只能被引用，不能被执行
```

---

## Agent 自进化机制

### 进化范围

```
可进化（需人工 approve）：
  .claude/agents/mosaic/*.md    ← Agent system prompt

不可进化（硬编码）：
  信任模型（initiator 验证逻辑）
  Artifact 契约（输入输出路径和格式）
  进化审批机制本身
```

### 进化提案生命周期

```
Agent 发现问题（连续失败 / 重复 pattern）
    ↓
生成 evolution_proposal（只能提，不能自己改）
    ↓
发起者 review（自然语言 diff）
    ├── /approve-evolution → 创建 snapshot + 写入新版本
    └── /reject-evolution  → 丢弃，记录原因
```

### 安全约束

- Agent 只能提案修改**自己的** prompt，不能修改其他 Agent
- 同一个 Agent 连续提案冷却期 24h
- 同时只能有一个待审批提案（`max_pending: 1`）
- 全版本化，可回退到任意历史版本
- **进化机制本身不可进化**

---

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript / Node.js |
| MCP SDK | @modelcontextprotocol/sdk |
| LLM 调用 (MVP) | Claude CLI (`claude --print`) + PQueue 串行队列 |
| LLM 调用 (Phase 2) | @anthropic-ai/sdk（有 API Key 时自动切换） |
| Git 操作 | @octokit/rest（GitHub 适配器） |
| UI 输出 | React + Tailwind CSS + Playwright（截图） |
| 工件校验 | zod |
| 状态持久化 | better-sqlite3 |
| 向量检索 (Phase 2) | sqlite-vec（SQLite 扩展） |
| 事件驱动 | eventemitter3 |
| 串行队列 | p-queue |

---

## 文件结构

```
src/
├── mcp/
│   ├── server.ts               # MCP Server 入口
│   └── tools.ts                # MCP 工具定义
├── core/
│   ├── pipeline.ts             # 流水线状态机引擎
│   ├── orchestrator.ts         # 全局编排器
│   ├── agent.ts                # Agent 基类
│   ├── artifact.ts             # 结构化工件定义 + 契约校验
│   ├── event-bus.ts            # 本地事件总线（eventemitter3）
│   ├── snapshot.ts             # 阶段快照与回退
│   ├── context-manager.ts      # 上下文管理（工件隔离）
│   └── llm-provider.ts        # LLM Provider 接口 + 调度队列
├── providers/
│   └── claude-cli.ts           # Claude CLI Provider (MVP)
├── adapters/
│   ├── types.ts                # Git 平台适配器接口
│   └── github.ts               # GitHub 适配器
├── agents/
│   ├── researcher.ts           # Researcher Agent
│   ├── product-owner.ts        # ProductOwner Agent
│   ├── ux-designer.ts          # UXDesigner Agent
│   ├── ui-designer.ts          # UIDesigner Agent
│   └── api-designer.ts         # APIDesigner Agent
├── evolution/
│   ├── engine.ts               # 进化引擎（记录分析 + 建议生成）
│   └── prompt-versioning.ts    # Prompt 版本管理
└── index.ts                    # CLI 入口

config/
├── pipeline.yaml               # 流水线配置（阶段/门控/重试/安全）
└── agents.yaml                 # Agent 编排配置（输入/输出契约）

.claude/agents/mosaic/          # Agent 能力定义（YAML frontmatter + MD）
├── researcher.md
├── product-owner.md
├── ux-designer.md
├── ui-designer.md
└── api-designer.md

.mosaic/                        # 运行时数据（git ignored）
├── artifacts/                  # 当前 Pipeline 的工件产出
├── snapshots/                  # 阶段快照
└── evolution/                  # 进化数据
    ├── records/
    └── prompts/
```

---

## 用户操作流（MVP）

```
1. mosaic run "开发一个博客系统"            ← 一条指令启动
2.（等待）Researcher 调研 + ProductOwner 生成 PRD
3. 收到通知：PRD 已完成，请审批             ← GitHub Issue
4. 审查 PRD → /approve 或 /reject + feedback
5.（等待）UXDesigner + UIDesigner 生成设计截图
6. 收到通知：设计截图已完成，请审批
7. 审查截图 → /approve 或 /reject + feedback  ← 设计师在此参与
8.（等待）APIDesigner 生成 API 规范
9. Pipeline 完成 → .mosaic/artifacts/ 中查看全部产出物
```

---

## 实施节奏

| 阶段 | 范围 | 里程碑 |
|---|---|---|
| Phase 1 | 核心引擎：Pipeline 状态机 + Agent 基类 + CLI Provider + 本地事件总线 | 能跑通空 Pipeline |
| Phase 2 | 产品团队：Researcher + ProductOwner Agent | 输入指令 → 输出 PRD |
| Phase 3 | 设计团队：UXDesigner + UIDesigner + APIDesigner | 输入 PRD → 输出截图 + API 规范 |
| Phase 4 | 安全 + 审批：信任验证 + GitHub Issue 持久化 + 人工门控 | 完整审批流程可用 |
| Phase 5 | 自进化：进化引擎 + Prompt 版本管理 | Agent 可提出进化提案 |

---

## 验证命令

```bash
npm test && npm run build
```
