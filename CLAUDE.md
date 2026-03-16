# Mosaicat — Project Guide

> 一条指令，AI 团队帮你从想法做到设计稿和 API 规范。
> 完整规范：plan/mosaic-project-plan.md

---

## MVP Pipeline

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
| LLM 调用 (MVP) | Claude CLI (`claude --print`) + PQueue 串行队列 |
| LLM 调用 | @anthropic-ai/sdk |
| Git 操作 | @octokit/rest |
| UI 输出 | React + Tailwind CSS + Playwright |
| 工件校验 | zod |
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
