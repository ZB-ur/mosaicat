# M7: 韧性 + 质量宪章 + 验收驱动 + 进化重构

## 状态：✅ 已完成

M7 所有 Phase 已实施完成。涵盖 Agent 宪章体系、验收测试驱动开发（Acceptance TDD）、渐进式修复循环、Stage Resume 崩溃恢复、LLM 无限重试、retry-log 数据分析、进化从自动改为手动 `mosaicat evolve`。

---

## 背景

M6 打通了 13 Agent 全链路，但实际长时间运行暴露了三类系统性问题：

1. **质量标准缺失** — Agent 各自为政，无统一质量底线。Coder 产出编译通过但功能空壳（Placeholder），Tester 无明确验收标准
2. **脆弱性** — Token 超限 / 网络断开导致整个 run 作废，之前的产出全部浪费；LLM 调用无重试，暂时性错误（429）直接失败
3. **进化浪费** — 每个 stage 后一次 LLM 调用做 evolution 分析，大部分被 cooldown 过滤，成本高于收益

M7 从两个维度系统性解决：
- **质量维度**：宪章 + 验收 TDD + 渐进修复 — 确保产出"真正能用"
- **韧性维度**：Stage Resume + 无限重试 + retry-log — 确保长运行不会因瞬时故障全盘作废

---

## 范围

### 质量体系（Phase K-N）

- ✅ Mosaicat Static Constitution — 6 条不可变质量法则（Phase K）
- ✅ 动态宪章生成机制 — BaseAgent hook 自动注入宪章到每个 Agent prompt（Phase L）
- ✅ Agent Prompt 统一结构 + 宪章集成（Phase M）
- ✅ QALead 重写为验收测试生成器 — 移到 Coder 前面（Acceptance TDD）（Phase N-1）
- ✅ Tester 简化为纯执行器 + Coder 验收测试集成（Phase N-2）
- ✅ 渐进式 5 轮修复循环（direct-fix → replan → full-history）（Phase N-3）
- ✅ Builtin Skills + 渐进式披露 + Skill 生命周期管理（Phase N-4）

### 韧性体系（Phase O）

- ✅ RetryingProvider — 所有 LLM Provider 通用的无限重试 + 指数退避（Step 1）
- ✅ retry-log 持久化 — 结构化错误日志 + 错误归类 + 高频模式统计（Step 3）
- ✅ Stage Resume — 崩溃恢复，从最后完成的 stage 续跑（Step 2）
- ✅ `mosaicat evolve` — 替代自动 stage-level evolution，基于 retry-log 真实数据生成 skill proposal（Step 4）

---

## 设计决策

### 宪章（Constitution）vs 更长的 Agent Prompt

**Decision:** 独立的 6 条不可变宪章，通过 BaseAgent hook 自动注入所有 Agent
**Why:** Prompt 越长 Agent 遵守率越低。宪章短小精悍（<60 行），且明确"违反即阻断"——不是建议，是硬约束
**Alternative:** 在每个 Agent prompt 里重复质量规则 — 重复 13 次，且修改需同步 13 处

### 验收 TDD（QALead before Coder）vs 先写代码再测试

**Decision:** QALead 移到 Coder 前面，先生成验收测试，Coder 目标是让测试通过
**Why:** M6 的 Tester 在 Coder 之后，发现问题时修复成本高（已写完全量代码）。TDD 让 Coder 有明确的"完成定义"
**Alternative:** 保持 Coder → Tester 顺序，增加修复轮次 — 浪费 token 且结果不稳定

### 渐进式修复 vs 固定策略

**Decision:** 5 轮修复循环，策略随轮次递进（direct-fix → replan-failed → full-history）
**Why:** 简单问题 1-2 轮 direct-fix 就能解决，复杂问题需要 replan。一开始就 replan 浪费 token
**Alternative:** 统一 replan 策略 — 对简单问题过度重量级

### Stage Resume vs 断点续传

**Decision:** 每个 stage 完成后持久化 `pipeline-state.json`，resume 时跳过已完成的 stage
**Why:** 简单可靠。比断点续传（stage 内中间状态恢复）实现简单 10x，覆盖 90% 场景
**Alternative:** Stage 内断点续传 — 复杂度极高，Coder 的 module 循环中间状态难以序列化

### RetryingProvider 装饰器 vs 每个 Provider 内置重试

**Decision:** 装饰器模式包裹所有 Provider
**Why:** claude-cli、anthropic-sdk、openai-compatible 统一受益，不需要每个 Provider 各写一遍
**Alternative:** 在各 Provider 内部处理重试 — 代码重复，且新增 Provider 容易遗漏

### `mosaicat evolve` 手动 vs 自动 stage-level evolution

**Decision:** 删除自动 stage-level evolution，改为手动 `mosaicat evolve` 命令
**Why:** 自动 evolution 每个 stage 后一次 LLM 调用，大部分被 cooldown 过滤。数据源改为 retry-log 真实失败数据，比 manifest 更精准
**Alternative:** 保留自动触发但降低频率 — 仍然浪费 token，且缺少人工选择时机的灵活性

---

## Phase 详情

### Phase K: Mosaicat Static Constitution (#297)

**问题：** Agent 无统一质量底线，产出质量参差不齐。

**方案：**
- 6 条不可变宪章法则：
  1. **Verifiability First** — 产出必须包含可程序化验证的质量标记
  2. **Spec Is Authority** — 下游只依赖上游规约，不依赖推理过程
  3. **No Ambiguous Pass-Through** — 不确定信息标注 `[NEEDS CLARIFICATION]`，不猜测
  4. **Acceptance-Driven Completion** — 完成标准 = 验收测试通过，不只是编译通过
  5. **No Placeholder Delivery** — 用户可见路径禁止占位内容
  6. **End-to-End Traceability** — F-NNN / T-NNN 全链路追溯不丢失
- **效果：** 所有 Agent 共享同一质量底线

### Phase L: 动态宪章机制 (#298-#299)

**问题：** 宪章需要自动注入每个 Agent，不能依赖人工维护。

**方案：**
- BaseAgent hook 机制：`constitution` / `placeholder` / `traceability` 三个 post-run 检查
- 宪章内容自动拼接到每个 Agent 的 system prompt
- **效果：** 新增 Agent 自动继承宪章，无需手动添加

### Phase M: Agent Prompt 统一结构 (#300-#301)

**问题：** 13 个 Agent prompt 格式各异，难以维护。

**方案：**
- 统一 prompt 结构：Role → Constitution → Task → Inputs → Outputs → Rules
- Agent 可观测性事件（thinking/response/progress 标准化）
- **效果：** prompt 可维护性大幅提升

### Phase N: 验收 TDD + 渐进修复 + Skill 管理 (#304-#310)

**问题：** Coder 无明确完成标准；Tester 职责模糊；修复策略单一；Skill 无生命周期管理。

**方案：**

**N-1: QALead 重写为验收测试生成器**
- QALead 移到 Coder 前面（pipeline: `qa_lead → coder → tester`）
- 从 PRD Feature ID 派生验收测试用例
- 输出可执行的 vitest 测试文件

**N-2: Coder 验收测试集成 + Tester 简化**
- Coder 读取 QALead 生成的测试，目标是让它们通过
- Tester 简化为纯测试执行器（不再生成测试代码）

**N-3: 渐进式 5 轮修复循环**
- Round 1-2: direct-fix（直接修复报错）
- Round 3: replan-failed-modules（重新规划失败模块）
- Round 4+: full-history-fix（带完整历史上下文）
- 累积上下文传递：每轮失败信息追加到 context

**N-4: Builtin Skills + 渐进式披露**
- Skill 存储在 `config/skills/builtin/`（标准 SKILL.md 格式）
- 按 trigger 关键词匹配加载：匹配的全量加载，不匹配的只加载摘要
- Skill 生命周期：使用计数 + 最后使用时间 + 废弃标记

### Phase O: 韧性体系 (当前 Phase)

**Step 1: RetryingProvider**
- 装饰器模式包裹所有 LLMProvider
- 无限重试 + 指数退避（1s → 2s → 4s → ... → 60s max）
- 只重试瞬时错误（429, 503, 502, 529, ECONNRESET, ECONNREFUSED）
- 不重试超时（LLM 在工作但没完成）和配置错误（ENOENT）

**Step 2: Stage Resume**
- 每个 stage 完成后持久化 `pipeline-state.json`
- `mosaicat resume [--run <runId>]` 从最后完成的 stage 续跑
- 崩溃恢复：`running` / `awaiting_*` 状态自动重置为 `idle`
- 缺失 artifact 时级联重置下游 stage

**Step 3: retry-log 持久化**
- 追加写入 `.mosaic/retry-log.jsonl`
- 错误自动归类：type-error / import-error / build-error / test-failure / rate-limit / timeout / ...
- 5 个日志写入点：LLM 重试、stage 重试、Tester→Coder 修复循环、Coder 模块修复、Coder 验收修复
- `getFailureStats()` 聚合高频模式

**Step 4: `mosaicat evolve`**
- 删除自动 stage-level evolution（`evolution.enabled: false`）
- 新增交互式 `mosaicat evolve` 命令
- 数据源：retry-log 真实失败数据（比 manifest 更精准）
- 流程：展示失败模式表 → LLM 生成 skill proposal → 人工逐条 approve/edit/reject

---

## 新增/修改文件汇总

### Phase K-N（质量体系）

| 文件 | 操作 | Phase |
|---|---|---|
| `.claude/agents/mosaic/constitution.md` | 新建 | K |
| `src/core/constitution.ts` | 新建 | L |
| `src/core/agent.ts` | 修改（hook 机制） | L |
| `.claude/agents/mosaic/*.md` (13 files) | 修改（统一结构） | M |
| `src/agents/qa-lead.ts` | 重写（验收测试生成器） | N-1 |
| `src/agents/tester.ts` | 重写（纯执行器） | N-2 |
| `src/agents/coder.ts` | 修改（验收测试集成） | N-2 |
| `src/core/orchestrator.ts` | 修改（5 轮渐进循环） | N-3 |
| `src/evolution/skill-manager.ts` | 修改（生命周期管理） | N-4 |
| `config/pipeline.yaml` | 修改（QALead → Coder 顺序） | N-1 |
| `config/agents.yaml` | 修改（扩展 Agent 契约） | N-1 |

### Phase O（韧性体系）

| 文件 | 操作 | Step |
|---|---|---|
| `src/core/retrying-provider.ts` | **新建** | 1 |
| `src/core/provider-factory.ts` | 修改（包裹 RetryingProvider） | 1 |
| `src/core/retry-log.ts` | **新建** | 3 |
| `src/core/resume.ts` | **新建** | 2 |
| `src/core/orchestrator.ts` | 修改（savePipelineState + resumeRun + 跳过 done + 删 stage evolution） | 2 + 4 |
| `src/core/pipeline.ts` | 修改（resetStageForResume） | 2 |
| `src/index.ts` | 修改（resume + evolve 命令） | 2 + 4 |
| `src/agents/coder.ts` | 修改（logRetry 调用点） | 3 |
| `src/core/evolve-runner.ts` | **新建** | 4 |
| `src/evolution/engine.ts` | 修改（analyzeFromRetryStats） | 4 |
| `config/pipeline.yaml` | 修改（evolution.enabled → false） | 4 |

---

## Pipeline 顺序（M7 完成后，full profile）

```
IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner →
UIDesigner → TechLead → QALead → Coder → Tester → SecurityAuditor →
Reviewer → Validator
```

关键变化：QALead 移到 Coder **前面**（验收 TDD）。

附加命令：
- `mosaicat refine` — 交付后定向修复
- `mosaicat resume` — 崩溃恢复续跑
- `mosaicat evolve` — 基于 retry-log 的手动进化

---

## Concept 变化汇总

| 维度 | M6 | M7 |
|---|---|---|
| **质量标准** | 编译通过 + 冒烟测试 | 宪章 6 条法则 + 验收测试通过 |
| **测试顺序** | Coder → QALead → Tester | QALead → Coder → Tester（TDD） |
| **修复策略** | Tester 失败 → Coder 重跑 1 轮 | 5 轮渐进修复（direct → replan → full-history） |
| **LLM 调用容错** | 无重试，失败即中止 | 无限重试 + 指数退避 |
| **Pipeline 容错** | 中断即全部作废 | Stage Resume，从断点续跑 |
| **进化触发** | 自动（每 stage 后） | 手动 `mosaicat evolve`（基于 retry-log 真实数据） |
| **Skill 管理** | 只有进化产出 | Builtin + 渐进披露 + 生命周期（使用统计、废弃标记） |
| **Agent Prompt** | 格式各异 | 统一结构 + 宪章自动注入 |

---

## 关键指标

| 指标 | M6 结束时 | M7 完成后 |
|---|---|---|
| Agent 数量 | 13 | 13（不变） |
| 质量规则 | 隐含在 prompt 中 | 6 条宪章 + BaseAgent hook 自动注入 |
| 测试模式 | 后置测试 | 验收 TDD（QALead → Coder → Tester） |
| 最大修复轮次 | 1 轮 | 5 轮（策略递进） |
| LLM 重试 | 0 | 无限（指数退避，max 60s） |
| 崩溃恢复 | 无 | Stage Resume |
| 进化模式 | 自动（每 stage 后 1 次 LLM） | 手动 `mosaicat evolve`（基于真实数据） |
| CLI 命令 | run, refine, setup, login, logout | + resume, evolve |
