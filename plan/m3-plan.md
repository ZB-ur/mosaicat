# Milestone 3: Spec 体系升级 + 研发团队 + 测试团队

## Context

M1（MVP）实现了 idea → 设计稿 + API 规范的 6 Agent 线性 Pipeline。M2 补全了可观测性、GitHub PR 流程、审批反馈和零配置认证。M3 的目标是：

1. **Spec 体系升级**（优先） — 为研发/测试团队提供可精确引用的 spec 基础
2. **研发团队** — 从设计稿到可运行代码
3. **测试团队** — 自动化测试生成

**当前核心瓶颈**：Pipeline 是硬编码的 6 阶段线性状态机（`StageName` 是 closed union），不支持新阶段、并行执行、条件跳过。

---

## 当前架构关键约束

| 约束 | 位置 | 影响 |
|------|------|------|
| `StageName` = 6 个字面量的 union type | `types.ts:5-14` | 新增 Agent 需改类型 + 所有 `Record<StageName, X>` |
| `STAGE_ORDER` 固定数组 | `types.ts:16` | 不支持 DAG / 并行 / 跳过 |
| `AGENT_MAP` 硬编码 | `agent-factory.ts` | 新 Agent 需改工厂 |
| `PipelineRun.stages` = `Record<StageName, StageStatus>` | `types.ts:46` | 新阶段需改 PipelineRun 类型 |
| Manifest 无 Feature ID 追溯 | `manifest.ts` | PRD `features: string[]`，Component 只有 `covers_flow` |
| Validator 假设所有 5 个 manifest 都存在 | `validator.ts` | 跳过阶段会导致验证失败 |

---

## Phase 计划

### Phase 1: Feature ID 追溯链

**目标**：结构化 Feature ID (`F-001`) 贯穿 PRD → UX → API → Component，Validator 可精确校验覆盖率。

**改动**：

| 文件 | 改动 |
|------|------|
| `src/core/manifest.ts` | PRD: `features: string[]` → `features: Array<{id, name}>` 或保持 `string[]` 但值改为 `F-001:feature-name` 格式；UX: `flows` 加 `covers_features`；API: `covers_feature` 改为 `covers_features: string[]`；Components: 加 `covers_features` |
| `src/agents/validator.ts` | 新增 Check 6: Feature ID 端到端追溯（PRD feature → 下游每层都有引用） |
| `.claude/agents/mosaic/product-owner.md` | 指导 LLM 为每个 feature 分配 `F-NNN` ID |
| `.claude/agents/mosaic/ux-designer.md` | 引用上游 Feature ID |
| `.claude/agents/mosaic/api-designer.md` | 引用上游 Feature ID |
| `.claude/agents/mosaic/ui-planner.md` | 引用上游 Feature ID |
| `.claude/agents/mosaic/validator.md` | 新增 Check 6 说明 |

**关键决策**：
- Feature ID 由 ProductOwner 分配（spec 唯一源头），下游只引用不创建
- 向后兼容：新字段全部 `.optional()`，无 ID 的旧 manifest 通过验证但显示 warning
- `covers_feature`（单数/string）保留向后兼容，新增 `covers_features`（复数/string[]）

**验证**：单元测试新 schema；Validator Check 6 测试；端到端 stub 测试

---

### Phase 2: 动态 Stage 注册

**目标**：`StageName` 从 closed union 变为 `string`，stage 列表由配置驱动，为新 Agent 打基础。

**改动**：

| 文件 | 改动 |
|------|------|
| `src/core/types.ts` | `StageName` → `string`；`STAGE_NAMES` 保留为 `DEFAULT_STAGES` 常量仅作参考；`PipelineRun.stages` → `Record<string, StageStatus>`；`PipelineConfig.stages` → `Record<string, StageConfig>`；`AgentsConfig.agents` → `Record<string, AgentOutputConfig>`；`Task.stage` → `string`；`PipelineRunSchema` 的 `z.enum(STAGE_NAMES)` → `z.string()` |
| `src/core/pipeline.ts` | `createPipelineRun()` 接受 `stageNames: string[]` 参数 |
| `src/core/agent-factory.ts` | 改为 registry 模式：`registerAgent(name, class)` + `createAgent(name)` |
| `src/core/orchestrator.ts` | 从 config 读 stage order 而非 `STAGE_ORDER` 常量 |
| `src/core/event-bus.ts` | 事件签名中 `StageName` → `string` |
| `src/core/context-manager.ts` | 移除 `StageName` import 依赖 |
| `src/core/run-manager.ts` | 同上 |
| `src/core/security.ts` | 同上 |
| `src/mcp/tools.ts` | stage 校验改为运行时检查（从 config 读） |
| `config/pipeline.yaml` | 新增 `stage_order: [...]` 字段 |
| 新建 `src/core/stage-registry.ts` | `StageRegistry` 类：读 config、暴露 `getStageOrder()`、`getStageConfig(name)` |

**关键决策**：
- `StageName` 变为 `string`，运行时由 StageRegistry 校验，编译时不再约束
- 默认行为不变：`stage_order` 缺省时回退到原 6 阶段顺序
- 所有现有测试必须零修改通过（证明向后兼容）

**风险**：这是影响面最大的 Phase（~30 文件），但改动是纯类型/引用层面的，无功能变更。

**验证**：全量现有测试通过；StageRegistry 单元测试；自定义 stage order 集成测试

---

### Phase 3: 条件 Stage 跳过

**目标**：`pipeline.yaml` 支持 `skip_when` 条件，Orchestrator 可跳过不需要的阶段。

**改动**：

| 文件 | 改动 |
|------|------|
| `src/core/types.ts` | `STAGE_STATES` 新增 `'skipped'`；`StageConfig` 新增 `skip_when?: SkipCondition` |
| `src/core/pipeline.ts` | 新增 `'skipped'` 状态转换；新增 `evaluateSkipCondition()` |
| `src/core/orchestrator.ts` | `executeStage()` 前检查 skip 条件 |
| `src/agents/validator.ts` | 缺失的 manifest 不再硬错误，改为 warning |
| `config/pipeline.yaml` | 文档化 `skip_when` 用法（默认不设任何 skip） |

**SkipCondition 设计**（简单模型，不做表达式引擎）：
```yaml
api_designer:
  skip_when:
    missing_input: api-spec.yaml   # 上游没产出就跳
    # 或
    tag: no-api                     # pipeline run 带此 tag 时跳
```

**验证**：`evaluateSkipCondition()` 单元测试；跳过 api_designer 的集成测试

---

### Phase 4: Pipeline DAG 执行引擎

**目标**：支持阶段间依赖图和并行执行，替代线性 `for` 循环。

**改动**：

| 文件 | 改动 |
|------|------|
| 新建 `src/core/pipeline-dag.ts` | `PipelineDAG` 类：拓扑排序 → 波次（wave）执行组；环检测 |
| `config/agents.yaml` | 每个 agent 新增 `depends_on?: string[]` |
| `src/core/types.ts` | `AgentOutputConfig` 新增 `depends_on?: string[]` |
| `src/core/orchestrator.ts` | 主循环从 `for stage of order` 改为 `for wave of dag.getWaves() { Promise.all(wave.map(...)) }` |

**波次执行模型**：
```
Wave 0: [researcher]
Wave 1: [product_owner]
Wave 2: [ux_designer]
Wave 3: [api_designer]
Wave 4: [ui_designer]
Wave 5: [validator]
```
无 `depends_on` 时，每个 stage 隐式依赖前一个（线性回退）。有 `depends_on` 时，同一波次的 stage 并行执行。

**线性兼容**：现有 6 个 agent 不设 `depends_on`，自动按原顺序线性执行。

**验证**：PipelineDAG 单元测试（环检测、波次计算、线性回退）；双并行 stage 集成测试

---

### Phase 5: TechLead Agent

**目标**：第一个研发团队 Agent，输出技术方案。

| 项目 | 值 |
|------|-----|
| Stage name | `tech_lead` |
| Input | `prd.md`, `ux-flows.md`, `api-spec.yaml` |
| Output | `tech-spec.md` + `tech-spec.manifest.json` |
| Gate | manual（人工审核技术方案） |
| depends_on | `[ui_designer]`（设计阶段全部完成后） |

**Manifest schema**：
```typescript
TechSpecManifestSchema = z.object({
  modules: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    covers_features: z.array(z.string()),
  })),
  tech_stack: z.record(z.string(), z.string()),
  implementation_tasks: z.array(z.object({
    id: z.string(),          // T-001
    module: z.string(),
    description: z.string(),
    covers_features: z.array(z.string()),
  })),
})
```

**新建文件**：`src/agents/tech-lead.ts`、`.claude/agents/mosaic/tech-lead.md`
**修改文件**：`manifest.ts`、`agent-factory.ts`（注册）、`agents/index.ts`、`agents.yaml`、`pipeline.yaml`

---

### Phase 6: Coder Agent（多实例并行）

**目标**：读取技术方案，逐模块/逐文件生成代码。

| 项目 | 值 |
|------|-----|
| Stage name | `coder` |
| Input | `tech-spec.md`, `api-spec.yaml`, `components/`（UI 参考） |
| Output | `code/` 目录 + `code.manifest.json` |
| Gate | auto（直接进入 Reviewer） |
| depends_on | `[tech_lead]` |

**设计**：复用 UIDesigner 的 Planner/Builder 两阶段模式：
1. **CodePlanner** — 读 tech-spec，生成 `code-plan.json`（文件级计划：路径、职责、依赖）
2. **CodeBuilder ×N** — 逐文件生成代码，每次 LLM 调用产出 1 个源文件
3. 支持 partial retry（根据 feedback 只重建部分文件）

**新建文件**：`src/agents/coder.ts`、`.claude/agents/mosaic/code-planner.md`、`.claude/agents/mosaic/code-builder.md`

---

### Phase 7: Reviewer Agent

**目标**：自动代码审查，检查 spec 合规性和代码质量。

| 项目 | 值 |
|------|-----|
| Stage name | `reviewer` |
| Input | `tech-spec.md`, `code.manifest.json`, 代码文件 |
| Output | `review-report.md` + `review.manifest.json` |
| Gate | manual（技术负责人 review） |
| depends_on | `[coder]` |

**Manifest schema**：
```typescript
ReviewManifestSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    file: z.string(),
    description: z.string(),
    covers_feature: z.string().optional(),
  })),
  spec_coverage: z.object({
    total_tasks: z.number(),
    covered_tasks: z.number(),
    missing_tasks: z.array(z.string()),
  }),
  verdict: z.enum(['pass', 'pass_with_warnings', 'fail']),
})
```

---

### Phase 8: QALead Agent

**目标**：从 spec 生成测试策略和测试用例。

| 项目 | 值 |
|------|-----|
| Stage name | `qa_lead` |
| Input | `prd.md`, `tech-spec.md`, `api-spec.yaml` |
| Output | `test-plan.md` + `test-plan.manifest.json` |
| Gate | auto |
| depends_on | `[tech_lead]`（与 Coder 并行！） |

**Manifest schema**：
```typescript
TestPlanManifestSchema = z.object({
  test_suites: z.array(z.object({
    name: z.string(),
    type: z.enum(['unit', 'integration', 'e2e', 'api']),
    covers_features: z.array(z.string()),
    test_cases: z.array(z.object({
      id: z.string(),
      description: z.string(),
      expected_result: z.string(),
    })),
  })),
})
```

**关键点**：QALead 和 Coder 同属 Wave N（都依赖 TechLead），DAG 引擎自动并行。

---

### Phase 9: Tester + SecurityAuditor Agent

**Tester**：

| 项目 | 值 |
|------|-----|
| Stage name | `tester` |
| Input | `test-plan.md`, 代码文件, `api-spec.yaml` |
| Output | `tests/` 目录 + `test-results.manifest.json` |
| Gate | auto |
| depends_on | `[coder, qa_lead]` |

**SecurityAuditor**：

| 项目 | 值 |
|------|-----|
| Stage name | `security_auditor` |
| Input | 代码文件, `api-spec.yaml`, `tech-spec.md` |
| Output | `security-report.md` + `security.manifest.json` |
| Gate | manual |
| depends_on | `[coder]` |

---

### Phase 10: 扩展 Validator + Pipeline Profile

**目标**：Validator 支持研发/测试 manifest；Pipeline Profile 支持不同使用模式。

**Validator 扩展**：
- 新增 Check 7: tech-spec modules 覆盖所有 PRD features
- 新增 Check 8: 代码文件覆盖所有 tech-spec tasks
- 新增 Check 9: 测试用例覆盖所有 features
- 新增 Check 10: 安全审计覆盖
- 缺失的可选 manifest（跳过的阶段）不报错，报 warning

**Pipeline Profile**：
```yaml
profiles:
  design-only:     # 默认，M1/M2 行为
    stages: [researcher, product_owner, ux_designer, api_designer, ui_designer, validator]
  full:            # 设计 + 研发 + 测试
    stages: [researcher, product_owner, ux_designer, api_designer, ui_designer, tech_lead, coder, reviewer, qa_lead, tester, security_auditor, validator]
  frontend-only:   # 跳过 API + 后端
    stages: [researcher, product_owner, ux_designer, ui_designer, tech_lead, coder, reviewer, qa_lead, tester, validator]
```
CLI: `mosaicat run "..." --profile full`

---

## M3 完成态 Pipeline DAG

```
                                                          ┌→ Coder ──→ Reviewer ─┐
Researcher → PO → UX → API → UI → TechLead(manual gate) ─┤                      ├→ Validator
                                                          └→ QALead ─→ Tester ───┘
                                                                      SecurityAuditor ─┘
```

- 设计阶段（Wave 0-4）：线性，与 M1/M2 一致
- TechLead（Wave 5）：manual gate，人工审核技术方案
- Coder + QALead（Wave 6）：**并行**
- Reviewer + Tester + SecurityAuditor（Wave 7）：Reviewer/SecurityAuditor 依赖 Coder；Tester 依赖 Coder+QALead
- Validator（Wave 8）：消费所有 manifest，最终交叉校验

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| Phase 2 动态 Stage 影响面大（~30 文件） | 高 | 纯类型改动，零功能变更，全量测试回归 |
| LLM 代码生成质量不稳定 | 中 | Planner/Builder 模式约束每次调用范围 + Reviewer 质量门控 |
| DAG 并行执行竞态 | 中 | 波次模型（Wave）+ artifact 隔离 + 每 stage 写独立文件 |
| Manifest schema 变更的向后兼容 | 低 | 新字段全部 `.optional()`，旧数据仍可通过 |

---

## 验证

每个 Phase 验证：
1. `npm run build` 通过
2. `npm test` 全量通过（含新增测试）
3. 端到端 stub 测试验证 pipeline 执行
4. Phase 2 后：自定义 stage order 集成测试
5. Phase 4 后：并行 stage 集成测试
6. Phase 10 后：`--profile full` 全流程测试
