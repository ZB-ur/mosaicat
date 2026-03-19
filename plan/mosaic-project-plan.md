# Mosaicat — AID 方法论参考实现（项目计划书 v3）

> ⚠️ 本文档是设计规范和决策记录。日常开发只需参考 `CLAUDE.md`（自动加载）。
> 仅在需要理解"为什么这样设计"时才需阅读本文档。

> 基于 v2 计划书的深度重审，围绕 AID 三大原则（意图前置 / 自治执行 / 经验沉淀）重构架构设计。

---

## 产品定位

Mosaicat 是 **AID（Autonomous Iterative Delivery）方法论**的参考实现。

AID 的核心洞察：AI Coding 时代，执行者从人变成了 AI Agent，瓶颈从"执行"转移到了"决策"。传统方法论优化执行效率，AID 优化**决策效率**——让人更高效地做出正确决策，让 AI 更自治地完成交付。

**一句话描述：** 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。

**核心理念：** 定义一种新的 AI Coding 赋能下的需求交付模式——AI 辅助人工，而非替代人工。设计师、产品经理等角色在流程中真实参与、审核、决策。

### AID 三大原则

| 原则 | 含义 | 解决的问题 |
|---|---|---|
| **意图前置** | 在执行之前充分澄清需求，减少决策返工 | 模糊指令导致的反复迭代 |
| **自治执行** | AI 自主完成全过程，人只在关键节点验收 | 人过度介入过程细节 |
| **经验沉淀** | 每次迭代的经验自动积累为 prompt 和 skill | 知识随人员流动而丢失 |

### AID vs 传统模型

| 维度 | Scrum/Agile | AID |
|---|---|---|
| 迭代周期 | 1-2 周 Sprint | 分钟级 Pipeline run |
| 人的角色 | 执行者 + 决策者 | 决策者（意图定义 + 结果验收） |
| 沟通方式 | 会议、文档、口头 | Artifact 契约 + 结构化澄清 |
| 知识积累 | 在人脑中，依赖文档化 | 在 Agent prompt + skill 中，自动沉淀 |
| 质量保障 | Code Review、QA 团队 | Agent 自评估 + Validator 交叉校验 |
| 反馈循环 | Sprint Retro | 自进化提案（实时） |

---

## 核心差异化（vs MetaGPT / CrewAI / LangGraph）

| 差异点 | 同类产品 | Mosaicat |
|---|---|---|
| 方法论 | 无，纯工具 | **AID 方法论**，框架是验证载体 |
| 接入方式 | 独立应用，脱离开发者工作流 | MCP 框架，融入 Claude Code 等现有工具 |
| 设计输出 | 纯文字/代码，无视觉产出 | **React 组件 + Playwright 截图**，设计师可审查 |
| 意图处理 | 直接执行用户指令 | **Agent 级意图澄清**，执行前主动消除模糊 |
| Agent 通信 | 内存中传递，不可追溯 | **Git Issue 驱动**，天然可审计 |
| 质量校验 | 无/简单检查 | **Validator + manifest 交叉校验**，低 token 高覆盖 |
| 使用门槛 | 需要 API Key | **仅需 Claude 订阅**，零额外配置 |
| 人工介入 | 要么全手动要么全自动 | **可配置审批门控**，任意节点可选人工/自动 |
| 上下文管理 | 全量传递，容易溢出 | **工件隔离**，Agent 只看契约内的 Artifact |
| 自我进化 | Prompt 固定不变 | **Prompt + Skill 双轨进化**（人工审批后生效） |
| 可追溯性 | 无/基本日志 | **分层日志系统**，支持按 run 复盘 |

---

## MVP 范围：idea → 设计稿 + API 规范

### Pipeline 顺序

```
用户指令（一条）
    ↓
Researcher Agent      → 竞品分析 + 可行性报告        [可澄清]
    ↓ 自动触发
ProductOwner Agent    → 结构化 PRD
    ↓ 人工审批门控
UXDesigner Agent      → 交互流程 + 组件清单            [可澄清]
    ↓ 自动触发
APIDesigner Agent     → OpenAPI 3.0 规范              [可澄清]
    ↓ 自动触发
UIDesigner Agent      → React 组件 + Playwright 截图
    ↓ 人工审批门控（设计师 review 截图）
Validator             → 交叉校验所有 Artifact 一致性
    ↓
完成，用户查看产出物
```

**关键调整（相对 v2）：**
- APIDesigner 移到 UIDesigner **之前**：UI 组件应基于确定的 API 契约设计数据绑定
- 新增 Validator：交叉校验所有 Artifact 的一致性
- 新增意图澄清能力：Researcher、UXDesigner、APIDesigner 可在执行前向用户提问

### 6 个 MVP Agent

| 团队 | Agent | 输入 | 输出 | 澄清 | 门控 |
|---|---|---|---|---|---|
| 产品团队 | Researcher | 用户指令 | `research.md` + `research.manifest.json` | 开启 | auto |
| 产品团队 | ProductOwner | 用户指令 + `research.md` | `prd.md` + `prd.manifest.json` | 关闭 | manual |
| 设计团队 | UXDesigner | `prd.md` | `ux-flows.md` + `ux-flows.manifest.json` | 开启 | auto |
| 设计团队 | APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` + `api-spec.manifest.json` | 开启 | auto |
| 设计团队 | UIDesigner | `prd.md` + `ux-flows.md` + `api-spec.yaml` | `components/` + `screenshots/` + `components.manifest.json` | 关闭 | manual |
| 质量 | Validator | 所有 `*.manifest.json` | `validation-report.md` | 关闭 | auto |

### 完整版本（Milestone 3）

> 上述团队规划对应 Milestone 3。当前 M1（MVP）和 M2（可观测性 + 交付）已完成。

```
产品团队 → 设计团队 → 研发团队 → 测试团队 → SRE 团队
  PRD    设计稿+API  代码+PR  测试报告  CI/CD+部署
```

| 团队 | Agents | 产出物 |
|---|---|---|
| 产品团队 | ProductOwner, Researcher | PRD、竞品分析、可行性报告 |
| 设计团队 | UXDesigner, UIDesigner, APIDesigner, Validator | React 组件截图、交互流程、API 规范 |
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
│ 分层日志系统                  │
├─ Agent 层 ───────────────────┤
│ 6 Agent（MVP）               │
│ 每个 Agent 独立调用 LLM      │
│ Agent 级意图澄清能力          │
├─ 基础设施层 ─────────────────┤
│ 上下文管理 / 快照 / 持久化    │
│ Skill 管理 / 进化引擎         │
└───────────────────────────────┘
```

**选择理由：** MCP 仅做触发和监控入口，自治引擎后台独立运行。Pipeline 内部用本地事件总线驱动（非 GitHub API 轮询），Git Issue 是状态的持久化记录和人工介入的入口。

### 2. LLM 调用：Claude CLI Provider + 串行队列

**决策：** MVP 使用 `claude --print` 调用模型，用户仅需 Claude 订阅，无需 API Key。

```
Provider A (默认):   Claude CLI → 用户的 Claude 订阅 → 零配置
Provider B (已实现): @anthropic-ai/sdk → API Key → 可并发
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

**已实现：** 有 API Key 的用户自动切换到 `@anthropic-ai/sdk`，支持并发（M1-Phase 3 完成）。

### 3. 上下文管理：工件隔离（核心原则）

**这是整个架构最关键的设计原则。**

每个 Agent 只看到**它需要的 Artifact**，不看过程、不看其他 Agent 的推理历史、不看完整 Pipeline 状态。

```typescript
type AgentContext = {
  system_prompt: string        // 该 Agent 的角色定义
  task: Task                   // 当前分配的任务
  input_artifacts: Artifact[]  // 仅契约内指定的文件
  available_skills: Skill[]    // 该 Agent 可用的 skill（私有 + shared）
  // ❌ 没有 pipeline history
  // ❌ 没有其他 agent 的推理过程
  // ❌ 没有完整的 issue thread
}
```

**用户原始指令只传递到 ProductOwner 为止。** 之后所有下游 Agent 的信息来源是 `prd.md`，它是唯一的"根"。

### 4. 意图澄清

Agent 级可选能力，在执行前主动向用户提问以消除模糊。

**执行流程：**
```
收到任务 + 输入 Artifact
    ↓
[clarification_enabled?]
    ├─ 是 → 分析输入，识别模糊点
    │        ├─ 有模糊点 → 生成澄清问题 → awaiting_clarification
    │        │              用户回答 → 补充到 Artifact → 继续执行
    │        └─ 无模糊点 → 继续执行
    └─ 否 → 直接执行
```

**约束：**
- 每次执行最多一轮澄清（一组问题，用户一次性回答）
- 澄清结果作为 Artifact 的补充，标注来源

**澄清结果格式（追加到 Artifact 末尾）：**
```markdown
---
## Clarifications [source: user]
- Q: 目标用户群体？ A: 面向独立开发者和小型团队
- Q: 是否需要多语言支持？ A: MVP 不需要
```

### 5. Artifact 契约 + Manifest

Agent 之间的唯一通信介质是**写到磁盘的文件**。路径和格式是契约的一部分。

**每个 Artifact 附带一份结构化 manifest**，用于 Validator 交叉校验（避免全量 Artifact 消耗过多 token）。

```
.mosaic/artifacts/
├── research.md                  # Researcher 产出
├── research.manifest.json       # 结构化摘要
├── prd.md                       # ProductOwner 产出
├── prd.manifest.json
├── ux-flows.md
├── ux-flows.manifest.json
├── api-spec.yaml                # APIDesigner 产出
├── api-spec.manifest.json
├── components/                  # UIDesigner 产出
│   ├── LoginForm.tsx
│   └── index.ts
├── screenshots/                 # UIDesigner 产出（Playwright 生成）
│   └── LoginForm.png
├── components.manifest.json
└── validation-report.md         # Validator 产出
```

**manifest 示例（prd.manifest.json）：**
```json
{
  "features": ["user-auth", "markdown-editor", "comment-system"],
  "constraints": ["no-third-party-auth"],
  "out_of_scope": ["payment", "i18n"]
}
```

**manifest 示例（api-spec.manifest.json）：**
```json
{
  "endpoints": [
    { "method": "POST", "path": "/auth/login", "covers_feature": "user-auth" },
    { "method": "GET",  "path": "/posts",      "covers_feature": "markdown-editor" }
  ],
  "models": ["User", "Post", "Comment"]
}
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

### 6. Validator 交叉校验

Validator 消费所有 `*.manifest.json`（非全量 Artifact），执行一致性校验：

- prd.features ↔ ux-flows.flows 覆盖率
- ux-flows 操作 ↔ api-spec.endpoints 覆盖率
- api-spec.models ↔ components.manifest 消费关系
- 命名一致性（PRD 术语是否贯穿所有 Artifact）

产出 `validation-report.md`，标注通过/不通过及具体不一致项。不通过则触发回退。

**token 控制：** 全量 Artifact 可能 5-8 万 token，manifest 总计 2-3k token。

### 7. UI 设计输出：Code-first

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

### 8. Agent 间通信：本地事件总线 + Git Issue 持久化

**决策：** Pipeline 内部用本地 EventEmitter 驱动，Git Issue 只做持久化记录和人工介入入口。

**理由：** MVP 是线性 Pipeline（6 Agent 串行执行），每阶段结束触发下一阶段，不存在并发 polling。GitHub API 5000 req/hr 的限制对我们不构成问题，但也没必要用 API 做内部驱动。

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

> **M2 更新**：Phase 8 已将审批流程从 Issue label/comment 改为 PR Review 模式。
> PR author = mosaicat[bot]（GitHub App），用户通过标准 GitHub Review（Approve/Request Changes）操作审批。
> Issue 仍用于 stage 进度记录和人工入口，但不再是审批的主要渠道。

### 9. Pipeline 状态机

**阶段状态流转：**
```
idle → running → awaiting_clarification → running → awaiting_human → approved → done
                                                                   └→ rejected → 回退到上一阶段
                                                                   └→ failed（超时/错误）
```

**回退策略：固定回退上一阶段**
```
Validator rejected    → UIDesigner 重试
UIDesigner rejected   → APIDesigner 重试
APIDesigner rejected  → UXDesigner 重试
UXDesigner rejected   → ProductOwner 重试
ProductOwner rejected → Researcher 重试
Researcher rejected   → 等待发起者修改原始指令
```

**审批门控配置：**
```yaml
# config/pipeline.yaml
stages:
  researcher:
    clarification: true
    gate: auto
  product_owner:
    clarification: false
    gate: manual
  ux_designer:
    clarification: true
    gate: auto
  api_designer:
    clarification: true
    gate: auto
  ui_designer:
    clarification: false
    gate: manual
  validator:
    clarification: false
    gate: auto

pipeline:
  max_retries_per_stage: 3
  snapshot: on_stage_complete
```

### 10. 快照与回退

**快照时机：每阶段完成时创建一次。**

```
.mosaic/snapshots/
└── {timestamp}/
    ├── artifacts/              # 该阶段完成时的全部 artifact 副本
    └── meta.json               # 阶段信息、Agent 版本、Issue 列表
```

**回退操作：**
1. 终止当前运行中的 Agent
2. 恢复到目标阶段的 snapshot
3. 关闭回退阶段之后创建的 Issue，标记 `[rolled-back]`
4. 从目标阶段重新执行

### 11. 自治执行模式

```
每个 Agent 的执行循环：
  [意图澄清（可选）]
      ↓
  输入 Artifact → 调用 LLM → 产出 Artifact + Manifest
      ↓
  自评估（内置 critic）
      ├─ 通过 → 写入 Issue → 等待门控（auto 或 human）
      └─ 不通过 → 自动修正（最多 3 次）
           └─ 超限 → 产出当前最佳版本 + 标记 [needs-review]
```

### 12. 日志与复盘

每次 Pipeline run 独立记录，用于事后复盘。

```
.mosaic/logs/
└── run-{timestamp}/
    ├── pipeline.log              # Pipeline 级：阶段流转、状态变化、耗时
    ├── agents/
    │   ├── researcher.log        # Agent 级：输入摘要、LLM 调用次数、自评估结果
    │   ├── product-owner.log
    │   ├── ux-designer.log
    │   ├── api-designer.log
    │   ├── ui-designer.log
    │   └── validator.log
    ├── clarifications.log        # 所有澄清问答记录
    └── evolution.log             # 进化提案记录
```

**日志层级：**

| 层级 | 记录内容 | 用途 |
|---|---|---|
| Pipeline | 阶段启动/完成/回退、门控结果、总耗时 | 全局复盘 |
| Agent | 输入 Artifact 清单、LLM 调用次数、自评估通过/重试、产出 Artifact 清单 | 单 Agent 效能分析 |
| Clarification | 问题-回答对、来源 Agent、时间戳 | 意图澄清有效性分析 |
| Evolution | Skill/Prompt 提案内容、审批结果、前后 diff | 进化轨迹追踪 |

**日志原则：**
- 不记录 LLM 完整 prompt/response（太大且含敏感信息），只记录摘要和元数据
- 日志只追加，不可修改
- 每次 run 独立目录，方便按次复盘

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
  initiator: "{github-login}"     # GitHub login，唯一可信源
  reject_policy: "silent"         # 非发起者的事件静默忽略
```

```typescript
function isTrustedActor(event: GitHubEvent): boolean {
  return event.sender.login === process.env.MOSAIC_INITIATOR_LOGIN
}
// 所有 webhook 事件第一步过这个检查
```

> **M2 更新**：Phase 9 引入 GitHub App Bot 认证（零配置模式）。
> 用户通过 `mosaicat login`（OAuth Device Flow）授权，initiator 身份从 OAuth token 自动获取。
> `MOSAIC_INITIATOR_LOGIN` 不再需要手动配置。

### 需要 Level 0 确认的操作

| 操作 | 理由 |
|---|---|
| Pipeline 启动 | 定义目标，是所有后续的根 |
| PRD 审批 | 需求确认权不能委托给 AI |
| 设计截图 approve | 视觉决策权不能委托给 AI |
| Pipeline 终止 / 回滚 | 破坏性操作 |
| 进化 approve | 修改 Agent prompt / 创建 Skill 是系统级变更 |

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

### 进化类型

| 进化类型 | 冷却 | 范围 | 审批 |
|---|---|---|---|
| Prompt 修改 | 24h | 仅自身 Agent | 人工 approve |
| Agent 描述修改 | 24h | 仅自身 Agent | 人工 approve |
| Skill 创建 | 无冷却 | 普适性判定 → 私有/共享 | 人工 approve |

### 进化范围

```
可进化（需人工 approve）：
  .claude/agents/mosaic/*.md    ← Agent system prompt + 描述
  .mosaic/evolution/skills/     ← Agent 自开发的 skill

不可进化（硬编码）：
  信任模型（initiator 验证逻辑）
  Artifact 契约（输入输出路径和格式）
  进化审批机制本身
```

### Prompt/描述 进化提案生命周期

```
Agent 发现问题（连续失败 / 重复 pattern / 用户反馈 / 效率低下）
    ↓
生成 evolution_proposal（只能提，不能自己改）
    ↓
发起者 review（自然语言 diff）
    ├── /approve-evolution → 创建 snapshot + 写入新版本
    └── /reject-evolution  → 丢弃，记录原因
```

### Skill 自开发

**Skill = 可复用的脚本模板/snippet，Agent 可以创建、保存、在后续执行中调用。**

```
Skill 创建流程：

Agent 发现可复用 pattern → 生成 Skill 提案
    ↓
自动判定普适性（LLM 评估）
    ├─ 专用（仅对特定 Agent 角色有价值）→ skills/{agent}/
    └─ 通用（跨角色可复用）→ skills/shared/
    ↓
人工 approve → 持久化
```

```
.mosaic/evolution/skills/
├── shared/                          # 通用 skill，所有 Agent 可用
│   └── markdown-table-formatter.md
├── ui-designer/                     # 专用 skill
│   └── screenshot-card-layout.ts
└── researcher/
    └── competitor-analysis-template.md
```

### 安全约束

- Agent 只能提案修改**自己的** prompt/描述，不能修改其他 Agent
- Prompt/描述修改冷却期 24h；Skill 创建无冷却
- 同时只能有一个待审批的 Prompt/描述提案（`max_pending: 1`）
- 全版本化，可回退到任意历史版本
- **进化机制本身不可进化**

---

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript / Node.js |
| MCP SDK | @modelcontextprotocol/sdk |
| LLM 调用 (MVP) | Claude CLI (`claude --print`) + PQueue 串行队列 |
| LLM 调用 (API) | @anthropic-ai/sdk |
| Git 操作 | @octokit/rest（GitHub 适配器） |
| GitHub App 认证 | @octokit/auth-app |
| 后端 | Cloudflare Workers + Hono（GitHub App 认证） |
| UI 输出 | React + Tailwind CSS + Playwright（截图） |
| 工件校验 | zod |
| 向量检索 (planned) | sqlite-vec（SQLite 扩展，Phase 2） |
| 事件驱动 | eventemitter3 |
| 串行队列 | p-queue |

---

## 文件结构

```
src/
├── mcp/
│   ├── server.ts               # MCP Server 入口
│   └── tools.ts                 # MCP 工具注册（registerTools）
├── mcp-entry.ts                 # MCP stdio 启动入口
├── core/
│   ├── types.ts                 # 全局类型定义
│   ├── pipeline.ts              # 流水线状态机引擎
│   ├── orchestrator.ts          # 全局编排器
│   ├── agent.ts                 # Agent 基类（BaseAgent, StubAgent）
│   ├── agent-factory.ts         # Agent 实例工厂
│   ├── artifact.ts              # 工件磁盘 I/O
│   ├── manifest.ts              # manifest 读写 + zod schema
│   ├── context-manager.ts       # 上下文组装（工件隔离 + Skill 注入）
│   ├── prompt-assembler.ts      # Prompt 拼装
│   ├── response-parser.ts       # LLM 响应解析
│   ├── llm-provider.ts          # LLM Provider 接口
│   ├── provider-factory.ts      # Provider 实例工厂
│   ├── event-bus.ts             # 本地事件总线
│   ├── cli-progress.ts          # 终端进度显示
│   ├── run-manager.ts           # MCP 运行管理
│   ├── interaction-handler.ts   # 用户交互抽象（CLI/Deferred）
│   ├── github-interaction-handler.ts  # GitHub PR Review 交互实现
│   ├── security.ts              # 信任模型 + 安全校验
│   ├── screenshot-renderer.ts   # Playwright 截图渲染
│   ├── snapshot.ts              # 阶段快照与回退
│   ├── logger.ts                # JSONL 日志系统
│   ├── artifact-presenter.ts   # OSC 8 终端超链接 + GitHub blob URL
│   ├── git-publisher.ts        # GitHub API 封装（纯 API，无本地 git）
│   ├── issue-manager.ts        # Stage/Step Issue 生命周期管理
│   └── pr-body-generator.ts    # PR body 生成（截图 + 预览 + 统计）
├── providers/
│   ├── claude-cli.ts            # Claude CLI Provider
│   └── anthropic-sdk.ts         # Anthropic SDK Provider
├── adapters/
│   ├── types.ts                 # Git 平台适配器接口
│   └── github.ts                # GitHub 适配器
├── agents/
│   ├── index.ts                 # Agent 统一导出
│   ├── llm-agent.ts             # LLMAgent 抽象基类
│   ├── researcher.ts
│   ├── product-owner.ts
│   ├── ux-designer.ts
│   ├── api-designer.ts
│   ├── ui-designer.ts
│   ├── ui-plan-schema.ts       # UI 组件 schema 定义
│   └── validator.ts
├── auth/
│   ├── types.ts                # 认证域类型（AuthConfig, CachedAuth, InstallationInfo）
│   ├── auth-store.ts           # ~/.mosaicat/auth.json 持久化
│   ├── oauth-device-flow.ts    # GitHub OAuth Device Flow
│   ├── token-service.ts        # 后端 API 通信（installations + token 交换）
│   └── resolve-auth.ts         # 认证编排（GitHub App 认证 + git remote 匹配）
├── evolution/
│   ├── types.ts                 # 进化域类型定义
│   ├── engine.ts                # 进化引擎
│   ├── prompt-versioning.ts     # Prompt 版本管理
│   ├── proposal-handler.ts      # 进化提案处理
│   └── skill-manager.ts         # Skill 管理（创建/分级/分发）
└── index.ts                     # CLI 入口

config/
├── pipeline.yaml                # 流水线配置（阶段/门控/重试/安全/进化）
└── agents.yaml                  # Agent 编排配置（输入/输出契约）

.claude/agents/mosaic/          # Agent Prompt 定义（可进化）
├── researcher.md
├── product-owner.md
├── ux-designer.md
├── api-designer.md
├── ui-designer.md
├── ui-planner.md
├── ui-builder.md
└── validator.md

backend/
├── src/
│   ├── index.ts               # Cloudflare Worker（Hono 路由）
│   └── auth.ts                # JWT 签名 + installation token 交换
├── wrangler.toml
└── package.json

.mosaic/                        # 运行时数据（git ignored）
├── artifacts/                  # 当前 Pipeline 的工件产出（含 manifest）
├── snapshots/                  # 阶段快照
├── logs/                       # 分层运行日志
│   └── run-{timestamp}/
└── evolution/
    ├── prompts/                # prompt 版本历史
    └── skills/                 # Agent 自开发的 skill
        ├── shared/
        └── {agent-name}/
```

---

## 用户操作流（MVP）

```
1. mosaicat run "开发一个博客系统"            ← 一条指令启动
2. Researcher 分析指令 → 向用户澄清           ← [可选] 意图澄清
3. 用户回答澄清问题 → Researcher 继续执行
4.（等待）Researcher 调研 + ProductOwner 生成 PRD
5. 收到通知：PRD 已完成，请审批               ← GitHub Issue
6. 审查 PRD → /approve 或 /reject + feedback
7.（等待）UXDesigner 生成交互流程（可能澄清）
8.（等待）APIDesigner 生成 API 规范（可能澄清）
9.（等待）UIDesigner 生成组件 + 截图
10. 收到通知：设计截图已完成，请审批
11. 审查截图 → /approve 或 /reject + feedback  ← 设计师在此参与
12.（等待）Validator 交叉校验
13. Pipeline 完成 → .mosaic/artifacts/ 中查看全部产出物
14. 查看 .mosaic/logs/ 复盘本次迭代
```

---

## 实施节奏

### Milestone 1: MVP — idea → 设计稿 + API 规范（✅ COMPLETE）

| 阶段 | 范围 | PR | 状态 |
|---|---|---|---|
| Phase 1 | 核心引擎：Pipeline 状态机 + Agent 基类 + CLI Provider + 事件总线 + 日志系统 | #24 | ✅ |
| Phase 2 | 真实 LLM Agent：Researcher / PO / UX / API / UI / Validator + Prompt + 澄清 | #33 | ✅ |
| Phase 3 | SDK + MCP + 截图：Anthropic SDK Provider、MCP Server、Playwright 渲染 | #41 | ✅ |
| Phase 4 | 安全 + 审批 + GitHub：信任模型、GitHub Issue 持久化、人工门控 | #56 | ✅ |
| Phase 5 | 自进化：进化引擎 + Prompt 版本管理 + Skill 管理 | #67 | ✅ |
| Phase 5.5 | 上下文优化：CLAUDE.md 模块速查表 | #75 | ✅ |
| Phase 5.6 | UIDesigner 渲染优化：设计系统 + 预览体验 | #83 | ✅ |
| Phase 5.7 | UIDesigner 多轮架构：Planner → Builder + Validator 文件完整性 + 结构化澄清 | #94 | ✅ |

### Milestone 2: 可观测性 + 产出交付 + 审批反馈（✅ COMPLETE）

> 详细文档：`plan/m2-plan.md`

| 阶段 | 范围 | PR | 状态 |
|---|---|---|---|
| M2-Phase 1 (T1) | Token 可观测：每阶段 + 总计 token 用量和费用 | #97 | ✅ |
| M2-Phase 2 (T2) | 产出链接：CLI / GitHub 模式下点击直达产出文件 | #100 | ✅ |
| M2-Phase 3 (T3) | GitHub PR 流程：pipeline 产出自动 commit → push → Draft PR | #103 | ✅ |
| M2-Phase 4 (T6) | 审批反馈 + 部分重试：拒绝时传递反馈，UIDesigner 部分组件重做 | #107 | ✅ |
| M2-Phase 5 (T4) | Issue 分层 + Step 模块化：stage issue → step issue 内聚分组 | #110 | ✅ |
| M2-Phase 6 (T5) | PR 预览：截图嵌入 PR body + 交互预览链接 | #113 | ✅ |
| Phase 7 | GitPublisher API 化：去除本地 git 依赖，纯 GitHub API 操作 | #120 | ✅ |
| Phase 8 | PR Review 审批流程：替代 Issue 审批，用户标准 Review 操作 | #127 | ✅ |
| Phase 9 | GitHub App Bot 认证：零配置 GitHub 模式 + OAuth Device Flow + Cloudflare Worker 后端 | #135 | ✅ |

> **注：** Phase 9 还包含 Step 9-12 的后续优化（Clarification UX、Stage Issue 丰富化、GitPublisher 修复、Stage Issue 重设计），详见 `plan/m2-plan.md`。

### Milestone 3: 意图深挖 + Provider 升级 + 研发团队

> 详细计划见 `plan/m3-plan.md`。核心目标：打通从意图到代码的全链路。

**核心升级：**

| 改进 | 说明 | 价值 |
|---|---|---|
| Provider 升级 | Claude CLI 支持 tool use + 结构化输出 + MCP server | Agent 从纯文本函数升级为有工具的自治单元 |
| Intent Consultant | 多轮动态对话深挖用户意图，产出结构化 Intent Brief | 减少模糊指令导致的返工 |
| Feature ID 追溯链 | `F-NNN` ID 贯穿 PRD → UX → API → Component | Validator 精确覆盖率校验 |
| Pipeline Profile | `design-only` / `full` / `frontend-only` 模式切换 | 按需裁剪 pipeline |
| Agent 自主度配置 | allowedTools / writable_paths / max_turns 可配置 | 过程自主 + 产出校验 |
| 移除 token/费用展示 | 精简代码，不做非核心功能 | 代码简洁 |
| CLI 交互改造 | inquirer 风格上下键选择 + 自由输入 | 更好的用户体验 |

**新增 Agent（M3 范围）：**

| Agent | 产出物 | 门控 |
|---|---|---|
| IntentConsultant | `intent-brief.json` | auto |
| TechLead | `tech-spec.md` + manifest | manual |
| Coder | `code/` + manifest（tool use + subagent 自主编码） | auto |
| Reviewer | `review-report.md` + manifest | manual |

**M4 预留：** QALead / Tester / SecurityAuditor Agent、DAG 执行引擎、Project Initializer

| 阶段 | 范围 | PR | 状态 |
|---|---|---|---|
| Phase 0 | Provider 升级 + 结构化输出 + CLI 交互 + MCP 配置 + Agent 自主度 | #153 | ✅ |
| Phase 1 | Intent Consultant（多轮对话 + Intent Brief） | #157 | ✅ |
| Phase 2 | Feature ID 追溯链（manifest schema + Validator Check 6） | #161 | ✅ |
| Phase 3 | 扩展 StageName union + 注册新 Agent | #165 | ✅ |
| Phase 4 | Pipeline Profile + 条件跳过 | #168 | ✅ |
| Phase 5 | 进化系统升级（stage 级 + Skill 标准化） | #171 | ✅ |
| Phase 6 | TechLead Agent | #174 | ✅ |
| Phase 7 | Coder Agent（tool use + subagent 自主编码） | #177 | ✅ |
| Phase 8 | Reviewer Agent | #180 | ✅ |
| Phase 9 | 扩展 Validator + MCP 适配 + 收尾 | — | ✅ |

---

## 验证命令

```bash
npm test && npm run build
```
