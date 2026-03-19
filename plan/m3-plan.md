# M3 实施计划

## Context

M1（MVP Pipeline）和 M2（可观测性 + 产出交付 + 审批反馈）已全部完成。M3 的目标是打通从意图到代码的全链路。

本计划基于启动 M3 前的深度讨论，核心共识包括：
- Provider 升级解锁 Agent tool use / 结构化输出 / subagent 能力
- 新增 Intent Consultant 做意图深挖（多轮动态对话）
- Agent 统一全面自主 + 可配置约束，约束链靠产出校验而非过程管控
- 契约模式递归应用（Pipeline 层 artifact 契约 → Agent 内部 code-plan 契约）
- StageName 扩展 union（方案 A），保留编译时类型安全
- DAG 引擎推迟到 M4（M3 无并行组），Pipeline Profile 通过过滤 stage 列表实现
- 移除 token/费用展示功能，保持代码简洁
- CLI 交互改为 inquirer 风格（上下键选择 + 自由输入）
- 测试团队 / Project Initializer / DAG 引擎推到 M4
- 在原项目上迭代，稳定模块保留，需大改的模块直接重写，不做向后兼容

---

## 实施步骤

### Step 0: 更新项目计划文档

**目标**：将讨论共识写入项目文档，作为后续实施的规范参考。

**修改文件**：
- `plan/m3-plan.md` — 用本计划的内容完整替换
- `plan/mosaic-project-plan.md` — 更新 M3 部分的概述和实施节奏表
- `CLAUDE.md` — 更新模块边界速查表（新增模块、状态变更）

---

### Phase 0: ClaudeCLIProvider 升级 + 预设 MCP + CLI 交互改造

**目标**：Agent 从 "纯文本函数" 升级为 "有工具的自治单元"。这是后续所有 Phase 的基础。

#### Step 0-1: ClaudeCLIProvider 升级

**修改文件**：
- `src/providers/claude-cli.ts` — 重写：`claude -p` 调用加入 `--allowedTools`、`--output-format json`、`--json-schema` 支持
- `src/core/llm-provider.ts` — `LLMProvider` 接口扩展：新增 `allowedTools?: string[]`、`jsonSchema?: object` 参数
- `src/providers/anthropic-sdk.ts` — 同步适配接口变更（tool use 该 provider 已支持）

#### Step 0-2: 废弃 response-parser + 精简 prompt-assembler

**修改文件**：
- `src/core/response-parser.ts` — 删除（结构化输出替代 delimiter 正则解析）
- `src/core/prompt-assembler.ts` — 重写：移除输出格式指令（delimiter 语法），只保留任务描述 + 上下文拼装
- `src/agents/llm-agent.ts` — 重写 `run()` 方法：改用结构化输出模式
- `src/agents/*.ts` — 所有 Agent 适配新的 `getOutputSpec()` 返回 JSON schema 而非 delimiter 列表

#### Step 0-3: 移除 token/费用展示

**修改文件**：
- `src/core/event-bus.ts` — 移除 `agent:usage`、`pipeline:usage` 事件
- `src/core/cli-progress.ts` — 移除费用显示逻辑
- `src/core/orchestrator.ts` — 移除 `stageMetrics` 中的 usage 追踪、Stage Issue 中的 metrics 区块
- `src/core/pr-body-generator.ts` — 移除 token 统计区块
- `src/core/security.ts` — `buildIssueBody()` 移除 metrics 相关参数和渲染
- `src/core/llm-provider.ts` — `LLMResponse` 中 `usage` 字段改为可选或移除

#### Step 0-4: CLI 交互改造

**新增依赖**：`@inquirer/prompts` 或 `@clack/prompts`

**修改文件**：
- `src/core/interaction-handler.ts` — `CLIInteractionHandler` 重写：审批用 select（Approve / Reject + feedback / 自由输入），澄清用 select（预设选项 + 自由输入）
- `src/index.ts` — 适配新交互模式

#### Step 0-5: 预设 MCP server 配置

**新增文件**：
- `config/mcp-servers.yaml` — 预设 MCP server 列表（Web Search、Web Fetch、File System）
- `src/core/mcp-loader.ts` — 启动时加载预设 MCP server 配置，传入 Provider 的 allowedTools

#### Step 0-6: Agent 自主度配置

**修改文件**：
- `config/agents.yaml` — 每个 agent 新增 `autonomy` 配置块（`allowed_tools`、`writable_paths`、`max_turns`、`max_budget_usd`）
- `src/core/agent-factory.ts` — 读取 autonomy 配置，传入 provider 调用参数

**验证**：
- 现有 Agent（如 Researcher）能通过 tool use 调用 WebSearch
- `--output-format json --json-schema` 能正确返回结构化 manifest
- CLI 交互改为 inquirer 风格
- `npm run build` 通过
- 现有测试适配后通过（response-parser 相关测试删除）

---

### Phase 1: Intent Consultant

**目标**：Pipeline 入口从 "一句指令" 变为 "结构化 Intent Brief"。

#### Step 1-1: Intent Brief Schema + Consultant Agent

**新增文件**：
- `src/agents/intent-consultant.ts` — 多轮对话 Agent，支持动态引导 + 自评收敛
- `.claude/agents/mosaic/intent-consultant.md` — System prompt：先消化用户输入再针对性引导，每轮多问题一次收集，预设选项由 LLM 动态生成
- `src/core/types.ts` — 新增 `IntentBrief` 接口（problem、target_users、core_scenarios、mvp_boundary、constraints、domain_specifics、recommended_profile、profile_reason）

#### Step 1-2: Orchestrator 集成

**修改文件**：
- `src/core/orchestrator.ts` — `run()` 方法开头插入 Intent Consultant 对话阶段；产出 Intent Brief 写入 artifact（`intent-brief.json`）
- `src/index.ts` — 支持用户 "随时说开始" 提前收敛
- `config/agents.yaml` — 新增 intent_consultant 配置（inputs: user_instruction, outputs: intent-brief.json）
- `config/pipeline.yaml` — 新增 intent_consultant stage 配置

#### Step 1-3: 下游 Agent 消费 Intent Brief

**修改文件**：
- `config/agents.yaml` — Researcher 和 ProductOwner 的 inputs 加入 `intent-brief.json`
- `.claude/agents/mosaic/researcher.md` — 引用 Intent Brief 而非原始指令
- `.claude/agents/mosaic/product-owner.md` — 同上

**验证**：
- 多轮对话交互正常（预设选项 + 自由输入 + 上下键选择）
- 用户可随时 "开始" 提前收敛
- Intent Brief 写入 artifact 且包含 recommended_profile
- Researcher/PO 能读取 Intent Brief
- `npm run build && npm test` 通过

---

### Phase 2: Feature ID 追溯链

**目标**：结构化 Feature ID（`{id, name}`）贯穿 PRD → UX → API → Component，Validator 精确校验覆盖率。

#### Step 2-1: Manifest Schema 升级

**修改文件**：
- `src/core/manifest.ts` — PrdManifestSchema: `features` 改为 `Array<{id: string, name: string}>`（如 `{id: "F-001", name: "Markdown 编辑器"}`）；UxFlowsManifestSchema: flows 改为 `Array<{name: string, covers_features: string[]}>`；ApiSpecManifestSchema: `covers_feature` → `covers_features: string[]`；ComponentsManifestSchema: `covers_flow` → `covers_features: string[]`

#### Step 2-2: Agent Prompt 更新

**修改文件**：
- `.claude/agents/mosaic/product-owner.md` — 指导 LLM 为每个 feature 分配 F-NNN ID
- `.claude/agents/mosaic/ux-designer.md` — 引用上游 Feature ID
- `.claude/agents/mosaic/api-designer.md` — 引用上游 Feature ID
- `.claude/agents/mosaic/ui-planner.md` — 引用上游 Feature ID
- `.claude/agents/mosaic/validator.md` — 新增 Check 6 说明

#### Step 2-3: Validator 扩展

**修改文件**：
- `src/agents/validator.ts` — 新增 Check 6: Feature ID 端到端追溯（PRD feature → UX flows → API endpoints → Components 每层都有引用）

**验证**：
- manifest schema 单元测试
- Validator Check 6 测试
- `npm run build && npm test` 通过

---

### Phase 3: 扩展 StageName + 注册新 Agent

**目标**：StageName union 从 6 扩展到 12（含 intent_consultant），为新 Agent 打基础。

#### Step 3-1: 类型扩展

**修改文件**：
- `src/core/types.ts` — `STAGE_NAMES` 扩展为 12 个：新增 `intent_consultant`、`tech_lead`、`coder`、`reviewer`、`qa_lead`、`tester`（后四个 M3 只注册 tech_lead/coder/reviewer，其余为 M4 预留 union 值）
- `src/core/types.ts` — `STAGE_STATES` 新增 `'skipped'` 状态（供 Pipeline Profile 跳过使用）
- `src/core/pipeline.ts` — `VALID_TRANSITIONS` 新增 `idle → skipped` 和 `skipped` 的转换规则

#### Step 3-2: Agent 注册

**修改文件**：
- `src/core/agent-factory.ts` — `AGENT_MAP` 扩展，注册 IntentConsultant、TechLead、Coder、Reviewer
- `src/agents/index.ts` — 导出新 Agent
- `src/core/orchestrator.ts` — `AGENT_DESC` 扩展

#### Step 3-3: 配置扩展

**修改文件**：
- `config/pipeline.yaml` — 新增 stage 配置（intent_consultant: gate auto; tech_lead: gate manual; coder: gate auto; reviewer: gate manual）
- `config/agents.yaml` — 新增 agent 配置（inputs/outputs/autonomy）

**验证**：
- 现有测试通过（原 6 stage 行为不变）
- 新 stage 配置能正确加载
- `npm run build && npm test` 通过

---

### Phase 4: Pipeline Profile + 条件跳过

**目标**：支持 `design-only` / `full` 等 Profile，通过过滤 stage 列表实现。不做 DAG。

#### Step 4-1: Profile 定义

**修改文件**：
- `config/pipeline.yaml` — 新增 `profiles` 配置块：
  ```yaml
  profiles:
    design-only:
      stages: [intent_consultant, researcher, product_owner, ux_designer, api_designer, ui_designer, validator]
    full:
      stages: [intent_consultant, researcher, product_owner, ux_designer, api_designer, ui_designer, tech_lead, coder, reviewer, validator]
    frontend-only:
      stages: [intent_consultant, researcher, product_owner, ux_designer, ui_designer, tech_lead, coder, reviewer, validator]
  ```
- `src/core/types.ts` — `PipelineConfig` 新增 `profiles` 字段

#### Step 4-2: Orchestrator 支持 Profile

**修改文件**：
- `src/core/orchestrator.ts` — `run()` 方法接受 `profile` 参数；主循环从 `STAGE_ORDER` 改为从 profile 读取 stage 列表；跳过的 stage 标记为 `skipped`
- `src/core/pipeline.ts` — `createPipelineRun()` 接受 `stageNames: StageName[]` 参数，只为传入的 stages 创建状态
- `src/index.ts` — 新增 `--profile` CLI flag（默认由 Intent Brief 推荐）
- `src/mcp/tools.ts` — `mosaic_run` 工具新增 `profile` 参数

#### Step 4-3: Validator 适配跳过

**修改文件**：
- `src/agents/validator.ts` — 缺失的 manifest（跳过的阶段）不报错，报 warning

**验证**：
- `--profile design-only` 只执行设计阶段
- `--profile full` 执行全部阶段
- 跳过的 stage 状态为 `skipped`
- Validator 对缺失 manifest 报 warning 不报错
- `npm run build && npm test` 通过

---

### Phase 5: 进化系统升级

**目标**：Stage 级进化 + Tool/Skill 分层 + Skill 格式对齐 Agent Skills 开放标准。

#### Step 5-1: Stage 级进化

**修改文件**：
- `src/core/orchestrator.ts` — 每个 stage 完成后调用进化分析（从 pipeline 结束后移到 stage 结束后）
- `src/evolution/engine.ts` — `analyze()` 支持单 stage 分析模式（不需要完整 pipeline 数据）

#### Step 5-2: Tool / Skill 分层明确

**修改文件**：
- `src/evolution/types.ts` — 明确区分 Tool（MCP server 引用）和 Skill（领域知识模板，SKILL.md 格式）
- `src/evolution/skill-manager.ts` — Skill 文件格式对齐 Agent Skills 开放标准（`SKILL.md` + YAML frontmatter + scripts/ + references/）

#### Step 5-3: Skill 格式对齐开放标准

**修改文件**：
- `.mosaic/evolution/skills/` — 目录结构对齐标准（每个 Skill 一个文件夹：SKILL.md + 可选 scripts/、references/）
- `src/evolution/skill-manager.ts` — 读写逻辑适配新格式
- `src/core/context-manager.ts` — Skill 注入逻辑适配新格式

**验证**：
- stage 完成后立即触发进化分析
- pipeline 中途失败时已完成 stage 的进化提案不丢失
- Skill 文件格式符合 Agent Skills 标准
- `npm run build && npm test` 通过

---

### Phase 6: TechLead Agent

**目标**：第一个研发团队 Agent，输出技术方案。

#### Step 6-1: Agent 实现

**新增文件**：
- `src/agents/tech-lead.ts` — 继承 LLMAgent（或直接使用自治模式），输入 PRD + UX + API spec，输出 tech-spec.md + tech-spec.manifest.json
- `.claude/agents/mosaic/tech-lead.md` — System prompt

**修改文件**：
- `src/core/manifest.ts` — 新增 `TechSpecManifestSchema`（modules、tech_stack、implementation_tasks，每个 task 有 id 和 covers_features）

**验证**：
- TechLead 能读取上游 artifact 并产出 tech-spec
- manifest 包含 Feature ID 追溯
- manual gate 审批正常
- `npm run build && npm test` 通过

---

### Phase 7: Coder Agent

**目标**：过程自主的代码生成 Agent，通过 tool use + subagent 自主拆解任务。

#### Step 7-1: Agent 实现

**新增文件**：
- `src/agents/coder.ts` — 高自主 Agent：读取 tech-spec → 生成 code-plan.json（接口契约）→ spawn 子 Agent 按模块并行编码 → 自行确定性校验（编译/测试/lint）→ 输出 code/ + code.manifest.json
- `.claude/agents/mosaic/coder.md` — System prompt（明确要求：自行验证通过后才提交产出）

**修改文件**：
- `src/core/manifest.ts` — 新增 `CodeManifestSchema`（files、modules、covers_tasks、covers_features）
- `config/agents.yaml` — coder 的 autonomy 配置：`allowed_tools: [Read, Write, Bash, Agent, WebSearch]`、`writable_paths: [".mosaic/artifacts/code/"]`

**验证**：
- Coder 能 spawn 子 Agent 并行编码
- 产出代码通过 tsc/lint 确定性校验
- code.manifest.json 包含 Feature ID 和 task ID 追溯
- `npm run build && npm test` 通过

---

### Phase 8: Reviewer Agent

**目标**：代码 vs spec 合规审查 + 质量检查。

#### Step 8-1: Agent 实现

**新增文件**：
- `src/agents/reviewer.ts` — 输入 tech-spec + code.manifest + 代码文件，输出 review-report.md + review.manifest.json
- `.claude/agents/mosaic/reviewer.md` — System prompt

**修改文件**：
- `src/core/manifest.ts` — 新增 `ReviewManifestSchema`（issues、spec_coverage、verdict）

**验证**：
- Reviewer 能读取代码文件和 spec
- review.manifest 包含 spec 覆盖率和 verdict
- manual gate 审批正常
- `npm run build && npm test` 通过

---

### Phase 9: 扩展 Validator + 收尾

**目标**：Validator 支持研发 manifest；整体集成验证。

#### Step 9-1: Validator 扩展

**修改文件**：
- `src/agents/validator.ts` — 新增 Check 7: tech-spec modules 覆盖所有 PRD features；新增 Check 8: 代码文件覆盖所有 tech-spec tasks；缺失的可选 manifest（跳过的阶段）报 warning 不报错
- `.claude/agents/mosaic/validator.md` — 更新 Check 列表

#### Step 9-2: MCP 工具适配

**修改文件**：
- `src/mcp/tools.ts` — `mosaic_run` 支持 profile 参数；stage 校验从 hardcode 改为从 config 读取；移除 `z.enum(STAGE_NAMES)` 中对旧 6 stage 的硬编码（改用扩展后的 `STAGE_NAMES`）

#### Step 9-3: 文档和配置收尾

**修改文件**：
- `CLAUDE.md` — 更新模块边界速查表（新增模块归类、冻结/活跃状态更新）
- `plan/mosaic-project-plan.md` — M3 实施状态更新
- `plan/m3-plan.md` — 最终版本确认

**验证**：
- `--profile full` 端到端执行：Intent Consultant → Researcher → PO → UX → API → UI → TechLead → Coder → Reviewer → Validator
- `--profile design-only` 跳过研发阶段
- Validator 全链路 Feature ID 追溯校验通过
- GitHub 模式：PR + Stage Issue + 审批流程正常
- `npm run build && npm test` 全量通过

---

## 关键设计决策

| 决策 | 结论 |
|------|------|
| Agent 自主度 | 统一全面开放 + 可配置约束（allowedTools / writable_paths / max_turns / max_budget） |
| 约束链保障 | 过程自主 + 产出校验（manifest 覆盖率 + 确定性工具 + Reviewer + 人） |
| StageName 类型 | 方案 A：扩展 union 到 12 个，保留编译时检查 |
| 技术栈校验 | Coder Agent 自行判断，不做适配 |
| 知识共享 | 契约模式递归应用（Pipeline 层 artifact → Agent 内部 code-plan） |
| CLI 交互 | inquirer 风格：上下键选择 + 自由输入，多问题一轮收集 |
| Token/费用展示 | 移除，保持代码简洁 |
| DAG 引擎 | 推迟到 M4 |
| Pipeline Profile | Intent Consultant 推断 + 用户确认，保留 --profile CLI flag 覆盖 |
| 进化时机 | Stage 级（每 stage 完成后立即分析） |
| Skill 格式 | 对齐 Agent Skills 开放标准（SKILL.md） |
| 向后兼容 | 不考虑，代码整洁优先 |

## M4 预留

- QALead / Tester / SecurityAuditor Agent
- DAG 执行引擎（并行 stage 组）
- Project Initializer（棕地项目初始化）
- 棕地知识层 MCP（codebase-memory-mcp + Repomix + ast-grep）

## 关键保留模块（不重写）

- `src/core/pipeline.ts` — 状态机引擎（仅扩展 skipped 状态）
- `src/core/artifact.ts` — 磁盘 I/O
- `src/core/snapshot.ts` — 快照
- `src/auth/*` — 整个认证模块
- `src/core/git-publisher.ts` — Git API 封装
- `src/core/github-interaction-handler.ts` — PR Review 审批
- `src/adapters/github.ts` — GitHub 适配器
- `src/core/security.ts` — 信任模型（仅移除 metrics 相关）

## 需要重写/大改的模块

- `src/providers/claude-cli.ts` — 重写（tool use + 结构化输出）
- `src/agents/llm-agent.ts` — 重写（执行模型变更）
- `src/core/response-parser.ts` — 删除
- `src/core/prompt-assembler.ts` — 大幅精简
- `src/core/orchestrator.ts` — 大改（去 usage、加 Profile、加 Intent Consultant、stage 级进化）
- `src/core/cli-progress.ts` — 重写（inquirer 交互）
- `src/core/event-bus.ts` — 精简（去 usage 事件）
- `src/index.ts` — 大改（新入口流程）

## 验证方式

每个 Phase 完成后：
1. `npm run build` 通过
2. `npm test` 通过（含新增测试）
3. Phase 0 后：验证 Agent tool use 和结构化输出
4. Phase 1 后：Intent Consultant 多轮对话 + Brief 产出
5. Phase 4 后：`--profile design-only` / `--profile full` 切换
6. Phase 9 后：`--profile full` 端到端全流程测试
