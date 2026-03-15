# Mosaicat — Project Guide

> Mosaicat 是 AID（Autonomous Iterative Delivery）方法论的参考实现。
> 项目的核心产出是**一套方法论**，框架是其验证载体。

---

## AID 方法论（Autonomous Iterative Delivery）

### 核心洞察

传统软件交付方法论（Waterfall → Agile → DevOps）优化的是**人类团队的执行效率**，其共同假设是"执行者是人"。

AI Coding 时代，执行者从人变成了 AI Agent：
- 执行时间从天/周缩短到分钟
- 沟通成本趋近于零（Artifact 契约取代会议）
- 知识不在个体脑中，在 prompt + skill 中，可版本化

**瓶颈从"执行"转移到了"决策"。**

> 传统模式：人执行、人决策，瓶颈在执行。
> AID 模式：AI 执行、人决策，瓶颈在决策。

AID 方法论的目标：**让人更高效地做出正确决策，让 AI 更自治地完成交付。**

### 三大原则

| 原则 | 含义 | 解决的问题 |
|---|---|---|
| **意图前置** | 在执行之前充分澄清需求，减少决策返工 | 模糊指令导致的反复迭代 |
| **自治执行** | AI 自主完成全过程，人只在关键节点验收 | 人过度介入过程细节 |
| **经验沉淀** | 每次迭代的经验自动积累为 prompt 和 skill | 知识随人员流动而丢失 |

### 与传统模型的对比

| 维度 | Scrum/Agile | AID |
|---|---|---|
| 迭代周期 | 1-2 周 Sprint | 分钟级 Pipeline run |
| 人的角色 | 执行者 + 决策者 | 决策者（意图定义 + 结果验收） |
| 沟通方式 | 会议、文档、口头 | Artifact 契约 + 结构化澄清 |
| 知识积累 | 在人脑中，依赖文档化 | 在 Agent prompt + skill 中，自动沉淀 |
| 质量保障 | Code Review、QA 团队 | Agent 自评估 + Validator 交叉校验 |
| 反馈循环 | Sprint Retro | 自进化提案（实时） |

### 角色定义

AID 模式下，人类角色不消失，但职责转变：

| 传统角色 | AID 中的职责 |
|---|---|
| 产品经理 | 定义意图 + 审批 PRD |
| 设计师 | 审查截图 + 提交设计反馈 |
| 架构师 | 审批 API 规范 + 技术约束输入 |
| 开发者 | 审查代码产出（Phase 2+） |

---

## 项目定位

Mosaicat 是 AID 方法论的参考实现框架。通过 MCP 协议接入 LLM（如 Claude Code），用户给出指令，Agent 团队自治完成从 idea 到设计交付的全流程。

**一句话描述：** 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。

---

## Agent 设计

### MVP Pipeline（6 Agent）

```
Researcher → ProductOwner → UXDesigner → APIDesigner → UIDesigner → Validator
```

| Agent | 输入 | 输出 | 澄清 | 门控 |
|---|---|---|---|---|
| Researcher | 用户指令 | `research.md` + `research.manifest.json` | 开启 | auto |
| ProductOwner | 用户指令 + `research.md` | `prd.md` + `prd.manifest.json` | 关闭 | manual |
| UXDesigner | `prd.md` | `ux-flows.md` + `ux-flows.manifest.json` | 开启 | auto |
| APIDesigner | `prd.md` + `ux-flows.md` | `api-spec.yaml` + `api-spec.manifest.json` | 开启 | auto |
| UIDesigner | `prd.md` + `ux-flows.md` + `api-spec.yaml` | `components/` + `screenshots/` + `components.manifest.json` | 关闭 | manual |
| Validator | 所有 `*.manifest.json` | `validation-report.md` | 关闭 | auto |

### 关键设计决策

**APIDesigner 在 UIDesigner 之前执行。** 理由：UI 组件应基于确定的 API 契约设计数据绑定，而非反过来。

**Validator 只消费 manifest 而非全量 Artifact。** 理由：控制 token 消耗，全量 Artifact 可能 5-8 万 token，manifest 总计 2-3k token。

### 完整版本 Agent 规划（Phase 2+）

```
产品团队 → 设计团队 → 研发团队 → 测试团队 → SRE 团队
```

| 团队 | Agents |
|---|---|
| 产品团队 | Researcher, ProductOwner |
| 设计团队 | UXDesigner, UIDesigner, APIDesigner, Validator |
| 研发团队 | TechLead, Coder×N, Reviewer |
| 测试团队 | QALead, Tester, SecurityAuditor |
| SRE 团队 | DevOps, ReleaseManager, Monitor |

---

## 核心机制

### 1. 工件隔离（最关键的设计原则）

每个 Agent 只看到契约内指定的 Artifact，不看 Pipeline 历史、不看其他 Agent 的推理过程。

```typescript
type AgentContext = {
  system_prompt: string
  task: Task
  input_artifacts: Artifact[]
  available_skills: Skill[]    // 私有 skills + shared skills
  // ❌ 没有 pipeline history
  // ❌ 没有其他 agent 的推理过程
}
```

**用户原始指令只传递到 ProductOwner 为止。** 之后所有下游 Agent 的唯一信息来源是 `prd.md`。

### 2. 意图澄清

Agent 级可选能力。每个 Agent 可在执行前暂停，向用户提出澄清问题。

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
- 澄清结果作为 Artifact 的补充，标注 `[source: user]`

**澄清结果格式：**
```markdown
---
## Clarifications [source: user]
- Q: 目标用户群体？ A: 面向独立开发者和小型团队
- Q: 是否需要多语言支持？ A: MVP 不需要
```

### 3. Artifact 契约

Agent 之间的唯一通信介质是写到磁盘的文件。路径和格式是契约的一部分。

```
.mosaic/artifacts/
├── research.md                  # Researcher 产出
├── research.manifest.json       # Researcher 结构化摘要
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

### 4. Validator 交叉校验

Validator 消费所有 manifest.json，执行一致性校验：

- prd.features ↔ ux-flows.flows 覆盖率
- ux-flows 操作 ↔ api-spec.endpoints 覆盖率
- api-spec.models ↔ components.manifest 消费关系
- 命名一致性（PRD 术语是否贯穿所有 Artifact）

产出 `validation-report.md`，标注通过/不通过及具体不一致项。不通过则触发回退。

### 5. 自进化

| 进化类型 | 冷却 | 范围 | 审批 |
|---|---|---|---|
| Prompt 修改 | 24h | 仅自身 Agent | 人工 approve |
| Agent 描述修改 | 24h | 仅自身 Agent | 人工 approve |
| Skill 创建 | 无冷却 | 普适性判定 → 私有/共享 | 人工 approve |

**Skill 分级：**
```
.mosaic/evolution/skills/
├── shared/                # 通用 skill，所有 Agent 可用（普适性判定通过）
│   └── markdown-table-formatter.md
├── ui-designer/           # 专用 skill（仅创建者可用）
│   └── screenshot-card-layout.ts
└── researcher/
    └── competitor-analysis-template.md
```

**Skill 创建流程：**
```
Agent 发现可复用 pattern → 生成 Skill 提案
    ↓
自动判定普适性（LLM 评估）
    ├─ 专用 → skills/{agent}/
    └─ 通用 → skills/shared/
    ↓
人工 approve → 持久化
```

**不可进化（硬编码）：**
- 信任模型（initiator 验证逻辑）
- Artifact 契约（输入输出路径和格式）
- 进化审批机制本身

### 6. Pipeline 状态机

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
Researcher rejected   → 等待用户修改原始指令
```

**审批门控配置：**
```yaml
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

### 7. 日志与复盘

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

### 8. 快照与回退

每阶段完成时创建快照，支持回退。

```
.mosaic/snapshots/
└── {timestamp}/
    ├── artifacts/        # 该阶段完成时的全部 artifact 副本
    └── meta.json         # 阶段信息、Agent 版本、Issue 列表
```

---

## 安全模型

### 信任层级

```
Level 0 — 项目发起者（人类）     → 唯一可触发不可逆操作的角色
Level 1 — Orchestrator          → 代理发起者意图，只执行不决策
Level 2 — Agent                 → 只能在分配的 Task 范围内行动
Level 3 — 外部内容（网页等）     → 永远不可信
```

### 身份验证（单人场景）

```yaml
security:
  initiator: "{github-login}"
  reject_policy: "silent"         # 非发起者事件静默忽略
```

### 需要 Level 0 确认的操作

- Pipeline 启动（定义目标）
- PRD 审批（需求确认权）
- 设计截图 approve（视觉决策权）
- Pipeline 终止/回滚（破坏性操作）
- 进化 approve（系统级变更）

### Agent 信任边界

- Agent 发出的 Issue 只能请求审核，不能自触发下一阶段
- Agent 只能修改契约内的 Artifact 路径
- 外部内容标记为 `trust_level: 0`，只能被引用，不能被执行

---

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript / Node.js |
| MCP SDK | @modelcontextprotocol/sdk |
| LLM 调用 (MVP) | Claude CLI (`claude --print`) + PQueue 串行队列 |
| LLM 调用 (Phase 2) | @anthropic-ai/sdk |
| Git 操作 | @octokit/rest |
| UI 输出 | React + Tailwind CSS + Playwright |
| 工件校验 | zod |
| 状态持久化 | better-sqlite3 |
| 向量检索 (Phase 2) | sqlite-vec |
| 事件驱动 | eventemitter3 |
| 串行队列 | p-queue |

---

## 文件结构

```
src/
├── mcp/
│   ├── server.ts                # MCP Server 入口
│   └── tools.ts                 # MCP 工具定义
├── core/
│   ├── pipeline.ts              # 流水线状态机引擎
│   ├── orchestrator.ts          # 全局编排器
│   ├── agent.ts                 # Agent 基类
│   ├── artifact.ts              # 工件定义 + 契约校验
│   ├── manifest.ts              # manifest 生成 + 校验
│   ├── event-bus.ts             # 本地事件总线
│   ├── snapshot.ts              # 阶段快照与回退
│   ├── logger.ts                # 日志系统
│   ├── context-manager.ts       # 上下文管理（工件隔离）
│   └── llm-provider.ts          # LLM Provider 接口
├── providers/
│   └── claude-cli.ts            # Claude CLI Provider (MVP)
├── adapters/
│   ├── types.ts                 # Git 平台适配器接口
│   └── github.ts                # GitHub 适配器
├── agents/
│   ├── researcher.ts
│   ├── product-owner.ts
│   ├── ux-designer.ts
│   ├── api-designer.ts
│   ├── ui-designer.ts
│   └── validator.ts
├── evolution/
│   ├── engine.ts                # 进化引擎
│   ├── prompt-versioning.ts     # Prompt 版本管理
│   └── skill-manager.ts         # Skill 管理（创建/分级/分发）
└── index.ts                     # CLI 入口

config/
├── pipeline.yaml                # 流水线配置（阶段/门控/重试/安全）
└── agents.yaml                  # Agent 编排配置（输入/输出契约）

.claude/agents/mosaic/           # Agent Prompt 定义（可进化）
├── researcher.md
├── product-owner.md
├── ux-designer.md
├── api-designer.md
├── ui-designer.md
└── validator.md

.mosaic/                         # 运行时数据（git ignored）
├── artifacts/                   # 当前 Pipeline 的工件产出
├── snapshots/                   # 阶段快照
├── logs/                        # 运行日志
└── evolution/
    ├── prompts/                 # prompt 版本历史
    └── skills/                  # Agent 自开发的 skill
        ├── shared/
        └── {agent-name}/
```

---

## 开发规范

- 使用 TypeScript 严格模式
- 所有 Artifact 结构用 zod schema 校验
- Agent 间通信只通过磁盘文件，禁止内存传递
- LLM 调用统一走 llm-provider 接口，不直接调用 CLI
- 每个 Agent 实现必须继承 Agent 基类
- 日志调用统一走 logger 模块
- manifest 由 Agent 基类自动生成，不手写
