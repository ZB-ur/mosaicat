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

## 核心设计原则

- 工件隔离：Agent 只看契约内 Artifact，不看 pipeline 历史
- 用户原始指令只传递到 ProductOwner 为止，下游唯一信息源是 `prd.md`
- 意图澄清：Agent 级可选，每次最多一轮，结果标注 `[source: user]`
- Validator 只消费 manifest（~3k token），不消费全量 Artifact
- 回退策略：固定回退上一阶段，每阶段最多重试 3 次
- 自进化需人工 approve，进化机制本身不可进化
- Agent 间通信只通过磁盘文件，禁止内存传递

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

---

## Vibe Coding 开发工作流

### 决策文档化

- 重大操作前写 **Decision:** [做什么] — [为什么] — [替代方案]

### Issue 驱动开发

- Phase 级 Issue：标签 `phase`，标题 `[Phase N] desc`
- Step 级 Issue：标签 `step`，标题 `[Phase N / Step M] desc`，body 引用 phase issue
- commit message 必须引用 Issue 号

### 分支与 PR

- 分支命名：`phase-N/short-desc`
- Step 工作在 Phase 分支上，不建子分支
- Phase 结束创建 PR to main，body 列出所有 Step Issue

### Commit 规范

- 格式：`<type>: <description> (#<issue>)`
- type: feat / fix / refactor / test / docs / chore

### 会话日志

- PostToolUse hook 自动记录，无需手动干预
- 日志位于 `.mosaic/logs/sessions/`
