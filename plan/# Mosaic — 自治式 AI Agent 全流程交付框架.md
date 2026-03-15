**# Mosaic — 自治式 AI Agent 全流程交付框架**



**## 产品定位**



一个通过 MCP 协议接入 LLM（如 Claude Code）的自治式 AI Agent 框架。用户给出一条指令，Agent 集群自主完成从 idea 到项目交付的全流程，中间无需人为频繁干预。



***\*一句话描述：\**** 一条指令，AI 团队帮你从想法做到设计稿和代码。



\---



**## 核心差异化（vs MetaGPT / CrewAI / LangGraph）**



| 差异点 | 同类产品 | Mosaic |

|---|---|---|

| 接入方式 | 独立应用，脱离开发者工作流 | MCP 框架，融入 Claude Code 等现有工具 |

| 设计输出 | 纯文字/代码，无视觉产出 | ***\*Figma 高保真设计稿\****（核心亮点） |

| Agent 通信 | 内存中传递，不可追溯 | ***\*Git Issue 驱动\****，天然可审计 |

| 使用门槛 | 需要 API Key | ***\*仅需 Claude 订阅\****，零额外配置 |

| 人工介入 | 要么全手动要么全自动 | ***\*可配置审批门控\****，任意节点可选人工/自动 |

| 上下文管理 | 全量传递，容易溢出 | ***\*工件隔离 + 摘要 + RAG\****，精确控制 token |

| 自我进化 | Prompt 固定不变 | ***\*Agent 自进化\****，基于使用经验持续优化 prompt/模板/流程 |



\---



**## 产品功能**



**### MVP 范围：idea → 高保真设计稿**



\```

用户指令（一条）

 ↓

ProductOwner Agent → 结构化 PRD（需求文档）

 ↓ 自动触发

Researcher Agent → 技术可行性分析 + 竞品调研

 ↓ 自动触发

UXDesigner Agent → 页面清单 + 交互流程 + 线框结构

 ↓ 自动触发

UIDesigner Agent → 配色/字体/Design Tokens → Figma 高保真设计稿

 ↓

用户在 Figma 中查看设计稿 → 审批/修改/回退

\```



**### 完整版本：idea → 全流程交付**



\```

产品团队 → 设计团队 → 研发团队 → 测试团队 → SRE 团队

 PRD   Figma设计稿  代码+PR  测试报告  CI/CD+部署

\```



**### 5 个 Agent 团队**



| 团队 | Agents | 产出物 |

|---|---|---|

| 产品团队 | ProductOwner, Researcher | PRD、竞品分析、可行性报告 |

| 设计团队 | UXDesigner, UIDesigner, APIDesigner | Figma 设计稿、交互流程、API 规范 |

| 研发团队 | TechLead, Coder×N, Reviewer | 代码、PR、Code Review |

| 测试团队 | QALead, Tester, SecurityAuditor | 测试用例、测试报告、安全扫描 |

| SRE 团队 | DevOps, ReleaseManager, Monitor | CI/CD 配置、部署配置、监控配置 |



\> SRE 范围限定：CI/CD 生成 + 部署配置 + 监控配置 + Release，不直接操作生产环境。



\---



**## 关键技术决策**



**### 1. 架构模式：自治引擎 + MCP 入口（方案 B）**



\```

┌─ MCP 层 ─────────────────────┐ ← Claude Code 等 LLM 客户端调用

│ 触发 / 查询进度 / 审批    │   仅做入口，不做编排

├─ 自治引擎层 ─────────────────┤ ← 核心差异化

│ 流水线状态机 + 工件触发器   │

│ Git Issue 事件总线      │

├─ Agent 层 ───────────────────┤

│ 5 团队 × 各角色 Agent    │

│ 每个 Agent 独立调用 LLM   │

├─ 基础设施层 ─────────────────┤

│ 上下文管理 / 记忆 / 持久化  │

└───────────────────────────────┘

\```



***\*选择理由：\**** 方案 A（MCP 纯工具）的能力已有成熟竞品，我们聚焦自治交付的差异化。MCP 仅做触发和监控入口，自治引擎后台独立运行。



**### 2. LLM 调用：Claude CLI Provider（零配置）**



***\*决策：\**** MVP 使用 `claude --print` 调用模型，用户仅需 Claude 订阅，无需 API Key。



\```

Provider A (MVP): Claude CLI → 用户的 Claude 订阅 → 零配置

Provider B (扩展): @anthropic-ai/sdk → API Key → 高并发

Provider C (扩展): OpenAI 兼容 / 本地模型

\```



***\*并发限制处理：\**** 编排器内置 LLM 调度队列，按订阅套餐限制并发 slot 数。



**### 3. Agent 间通信：Git Issue 驱动**



***\*决策：\**** 所有 Agent 通过 GitHub Issue/PR 评论交流，不使用内存事件总线。



\- 每个阶段对应一个 Issue，子任务为子 Issue

\- Agent 产出物写入 Issue 评论（结构化工件）

\- Issue Label 做状态机流转（`idea` → `designing` → `coding` → `testing` → `deploying` → `done`）

\- 用户可在 Issue 评论中干预：`/approve` `/rollback` `/pause` `/abort`



***\*Git 平台：\**** 可插拔适配器模式。MVP 实现 GitHub 适配器，预留接口扩展 GitLab 等。



**### 4. 自治机制：工件触发 + 自评估循环**



\```

每个 Agent 的执行模式：

 输入工件 → 调用 LLM → 产出工件

  ↓

 自评估（内置 critic）

  ├─ 通过 → 写入 Issue → 自动触发下游 Agent

  └─ 不通过 → 自动修正（最多 3 次）

​    └─ 超限 → 产出当前最佳版本 + 标记 [needs-review]

\```



***\*回退循环：\**** Reviewer/Tester 发现问题 → Issue 评论反馈 → Coder 自动修复 → 重新审查（最多 3 轮）



**### 5. 回退机制：事务式快照回退**



***\*触发方式：\**** 用户在 Issue 评论 `/rollback to:design`，或 Agent 检测到架构性问题自动回退。



***\*回退操作：\****



1. 终止所有运行中的 Agent（kill 子进程）
2. 已提交的 PR → 关闭（已合并 → 创建 revert PR，不 force push）
3. Issue → 回退目标之后的子 Issue 关闭并标记 `[rolled-back]`
4. 工件 → 标记 invalidated（不删除，保留审计）
5. 重新打开目标阶段 Issue → Agent 重新执行



***\*关键：\**** 每个阶段开始前创建快照（git ref + 创建的 Issue/PR 列表 + 工件版本），回退时按快照逆向操作。



**### 6. 上下文管理：工件隔离 + 分层记忆**



***\*核心原则：\**** Agent 不接收完整对话历史，只接收所需的结构化工件。



\```

┌─ 工作记忆 ──────┐ 当前 Agent 执行上下文，用完即弃

├─ 工件存储 ──────┤ 结构化文档（PRD/架构/API Spec），按需检索

├─ 知识库 ────────┤ 向量索引，语义检索历史工件片段

└─────────────────┘

\```



\- ***\*工件摘要：\**** 大型工件自动生成摘要版（代码 → 函数签名 + 文件树），下游按需拉取全文

\- ***\*Token 预算：\**** 每个 Agent 配置 token 上限，超出时自动裁剪

\- ***\*代码分块：\**** 大项目按模块拆分，每个 Coder 只处理一个模块



**### 7. Figma 集成：模板库组合（路线 B）**



***\*决策：\**** 预置 UI 组件模板库在 Figma 中，Agent 选择组件 + 排列布局 + 填充内容，而非从零绘制。



***\*设计知识库：\**** 参考 ui-ux-pro-max-skill 项目的设计数据（161 配色方案、67 UI 风格、57 字体搭配），用 TypeScript 重写检索逻辑。



***\*分步实现：\****



\- Step 1：跑通文字版流程（PRD → 设计描述文档）

\- Step 2：接入 Figma API，输出可编辑的高保真设计稿



**### 8. 审批门控：可配置**



\```yaml

\# config/pipeline.yaml

stages:

 product:

  gate: auto     # 默认自动流转

 design:

  gate: auto

 development:

  gate: auto

 testing:

  gate: auto

 deployment:

  gate: manual    # 默认需要人工审批

\```



用户可按需将任意阶段设为 `manual`。安全高危漏洞强制 `manual`，无论配置如何。



**### 9. Agent 配置：两层分离**



***\*决策：\**** Agent 的"能力定义"和"编排配置"分开管理。



\- ***\*能力定义\****（`.claude/agents/mosaic/*.md`）：YAML frontmatter + Markdown，定义 Agent 的 prompt、技能、hooks

\- ***\*编排配置\****（`config/agents.yaml`）：定义 Agent 在流水线中的位置、输入/输出工件类型、审批门控、团队归属



\```yaml

\# config/agents.yaml

teams:

 product:

  agents:

   \- name: product-owner

​    ref: .claude/agents/mosaic/product-owner.md

​    input_artifacts: [UserInstruction]

​    output_artifacts: [PRD]

​    gate: auto

​    max_retries: 3

   \- name: researcher

​    ref: .claude/agents/mosaic/researcher.md

​    input_artifacts: [PRD]

​    output_artifacts: [FeasibilityReport]

​    gate: auto

 design:

  agents:

   \- name: ux-designer

​    input_artifacts: [PRD]

​    output_artifacts: [Wireframe, InteractionFlow]

   \- name: ui-designer

​    input_artifacts: [Wireframe, InteractionFlow]

​    output_artifacts: [FigmaDesign, DesignTokens]

\```



**### 10. Agent 自进化机制**



***\*决策：\**** Agent 的 prompt、工件模板、流程配置基于使用经验持续优化，用得越多越好用。



***\*三层进化：\****



1. ***\*Prompt 进化\**** — 记录每次执行结果和用户反馈，分析共性问题，自动建议 prompt 补充项
2. ***\*工件模板进化\**** — 用户多次手动补充的字段自动加入模板（如 PRD 模板自动增加"性能需求"章节）
3. ***\*流程进化\**** — 高频回退点自动增加门控检查（如"架构阶段回退率高→自动增加架构完整性检查"）



***\*安全边界：\****



\- 建议而非强制：进化建议通过 Issue 评论展示，用户 `/approve-evolution` 后才应用

\- 全版本化：prompt/模板每次变更都有版本号，可回退到任意历史版本

\- 透明可审计：所有进化记录和依据在 Issue 中可查



***\*存储：\****



\```

.mosaic/evolution/

├── records/     # 执行记录（任务/反馈/得分）

├── prompts/     # Prompt 版本历史

│  └── product-owner/v1.md, v2.md, current.md

├── templates/    # 工件模板版本历史

└── insights.json   # 用户偏好画像（技术栈/风格/常见需求）

\```



\---



**## 技术栈**



| 层 | 技术 |

|---|---|

| 语言 | TypeScript / Node.js |

| MCP SDK | @modelcontextprotocol/sdk |

| LLM 调用 (MVP) | claude CLI（用户 Claude 订阅） |

| Git 操作 | @octokit/rest（GitHub 适配器） |

| Figma 操作 | Figma REST API / Plugin API |

| 工件校验 | zod |

| 状态持久化 | better-sqlite3 |

| 事件驱动 | eventemitter3 |

| 设计知识库 | 基于 ui-ux-pro-max-skill 数据，TS 重写 |



\---



**## 文件结构**



\```

src/

├── mcp/

│  ├── server.ts       # MCP Server 入口

│  └── tools.ts        # MCP 工具定义

├── core/

│  ├── pipeline.ts      # 流水线状态机引擎

│  ├── orchestrator.ts    # 全局编排器

│  ├── agent.ts        # Agent 基类

│  ├── artifact.ts      # 结构化工件定义

│  ├── issue-bus.ts      # Git Issue 事件总线

│  ├── label-fsm.ts      # Issue Label 状态机

│  ├── snapshot.ts      # 阶段快照与回退

│  ├── context-manager.ts   # 上下文管理

│  ├── memory.ts       # 分层记忆

│  └── llm-provider.ts    # LLM Provider 接口 + 调度队列

├── providers/

│  ├── claude-cli.ts     # Claude CLI Provider (MVP)

│  ├── anthropic-api.ts    # API 直连 Provider (扩展)

│  └── openai-compat.ts    # OpenAI 兼容 Provider (扩展)

├── adapters/

│  ├── types.ts        # Git 平台适配器接口

│  ├── github.ts       # GitHub 适配器

│  └── figma.ts        # Figma 适配器

├── teams/

│  ├── product.ts       # 产品团队: ProductOwner, Researcher

│  ├── design.ts       # 设计团队: UXDesigner, UIDesigner, APIDesigner

│  ├── development.ts     # 研发团队: TechLead, Coder, Reviewer

│  ├── quality.ts       # 测试团队: QALead, Tester, SecurityAuditor

│  └── sre.ts         # SRE 团队: DevOps, ReleaseManager, Monitor

├── design-knowledge/

│  └── index.ts        # 设计知识库（配色/字体/风格检索）

├── evolution/

│  ├── engine.ts       # 进化引擎（记录分析+建议生成）

│  └── prompt-versioning.ts  # Prompt 版本管理

└── index.ts          # CLI 入口



config/

├── pipeline.yaml       # 流水线配置（阶段/门控/重试）

└── agents.yaml        # Agent 编排配置（团队/工件/门控）



.claude/agents/mosaic/     # Agent 能力定义（YAML+MD）

├── product-owner.md

├── researcher.md

├── ux-designer.md

├── ui-designer.md

├── api-designer.md

├── tech-lead.md

├── coder.md

├── reviewer.md

├── qa-lead.md

├── tester.md

├── security-auditor.md

├── devops.md

├── release-manager.md

└── monitor.md



.mosaic/evolution/       # 进化数据（运行时生成）

├── records/          # 执行记录

├── prompts/          # Prompt 版本历史

├── templates/         # 工件模板版本历史

└── insights.json       # 用户偏好画像

\```



\---



**## 用户操作流（极简路径）**



\```

1. mosaic run "开发一个博客系统"   ← 唯一一次人工操作

2.（等待）              ← Agent 自治运行，进度在 GitHub Issue 可见

3. 收到通知：设计稿已完成       ← Figma 链接在 Issue 评论中
4. 在 Figma 中查看设计稿       ← 可直接编辑或评论反馈
5. 在 Issue 评论 "/approve"      ← 批准进入下一阶段
6. 完成

\```



\---



**## 实施节奏**



| 阶段 | 范围 | 周期 |

|---|---|---|

| Step 1 | MCP 入口 + 产品团队 + 文字版设计流程 | 1-2 周 |

| Step 2 | Figma 集成，高保真设计稿输出 | 2-3 周 |

| Step 3 | 研发团队 + 测试团队 | 3-4 周 |

| Step 4 | SRE 团队 + 完整闭环 | 2-3 周 |



\---



**## 验证命令**



\```bash

npm test && npm run build

\```