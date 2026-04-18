# Phase 9: Quality Gate Infrastructure - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Pipeline stages cannot advance when output contains stubs, placeholder components, or misreported coverage. Bad output is blocked, not passed through. This phase builds the programmatic quality gate infrastructure that sits between stages.

Requirements: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05

</domain>

<decisions>
## Implementation Decisions

### Stub 检测方式 (GATE-01, GATE-02)
- **D-01:** 使用 TypeScript compiler API 进行 AST 解析检测 stub 代码。检测空函数体、return null/undefined、空 div shell、空对象体等。
- **D-02:** AST 检测只针对 Coder/UIDesigner 产出的代码文件（.ts/.tsx/.js/.jsx）。其他 stage（prd.md、ux-flows.md 等）继续使用现有的 regex placeholder-check。
- **D-03:** 现有 `placeholder-check.ts` 的 6 个 regex pattern 保留，AST 检测作为额外层叠加，不替换。

### implementation_status 判定 (GATE-03)
- **D-04:** 使用 AST 指标组合判定 stub/partial/complete：函数体行数 < 3 且 return null → stub；有 TODO/FIXME + 部分实现 → partial；其余 → complete。由程序化扫描填充，不依赖 LLM 自报告。
- **D-05:** `code.manifest.json` 每个文件条目新增 `implementation_status` 字段。

### 阻断策略 (GATE-01)
- **D-06:** 全部阻断 — 只要不是 complete 就阻断 pipeline。stub 和 partial 都 mandatory fail。Coder 的 fix loop 可根据 stub/partial 标记触发修复。

### 质量数据传递 / Validator 改造 (GATE-04, GATE-05)
- **D-07:** 扩展现有 manifest schema，每个 stage 的 manifest 新增 `quality_gate` 字段（stub_count、coverage_gaps、implementation_status 等）。不新建额外 artifact。
- **D-08:** Validator 汇总所有 stage manifest 的 `quality_gate` 字段，产出全链路完整性评估报告。与现有消费 manifest 的模式一致。
- **D-09:** 特性覆盖验证：每个 stage 结束后对比 PRD feature list 与 manifest 的 covers_features 字段，缺失的 feature 记录到 quality_gate.coverage_gaps。

### Folded Todos
- **Improve pipeline artifact quality** — 来自 todo backlog，与 phase 9 质量门控直接相关，scope 已包含在 GATE-01~05 中。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hook 系统
- `src/core/hooks/placeholder-check.ts` — 现有 placeholder regex 检测，Phase 9 在此基础上叠加 AST 检测
- `src/core/hooks/index.ts` — hook 注册逻辑，Phase 8 已设 ui_designer mandatory
- `src/core/agent.ts` — BaseAgent hook 执行流程（preRun → run → postRun）

### Manifest 系统
- `src/core/manifest.ts` — manifest schema 注册 + fail-closed 验证（Phase 8）
- `config/agents.yaml` — 每个 agent 的输出契约定义

### Validator
- `src/agents/validator.ts` — 现有 Validator 实现，已有 programmatic coverage check
- `src/core/hooks/traceability-check.ts` — 现有 feature ID 追踪 hook

### Pipeline 状态机
- `src/core/pipeline.ts` — stage 状态转换逻辑
- `src/core/pipeline-loop.ts` — pipeline 执行循环，hook 失败处理

### Coder 修复循环
- `src/core/fix-loop-runner.ts` — Tester→Coder 修复循环，Phase 9 的阻断可触发此循环

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `placeholderCheckHook` — 已有 6 个 regex pattern + 注释行跳过逻辑，AST 检测可作为同一 hook 的扩展或新 hook
- `traceabilityCheckHook` — 已有 feature ID 对比逻辑，可参考模式做 coverage gap 检测
- `MANIFEST_SCHEMAS` — 11 个已注册 schema，新增 quality_gate 字段需扩展这些 schema
- TypeScript 已是项目依赖（tsconfig.json target ES2022），compiler API 可直接使用

### Established Patterns
- Hook 按 stage 注册（switch-case in `getHooksForStage`），mandatory 用 spread override
- Manifest schema 用 Zod 定义，写入时自动校验
- Validator 消费所有 `*.manifest.json` 的 summaryExtractor

### Integration Points
- `getHooksForStage()` 需为 coder/ui_designer 注册新的 AST quality gate hook
- `code.manifest.json` 的 Zod schema 需扩展 implementation_status 字段
- 所有 manifest schema 需扩展 quality_gate 字段
- Validator 需读取 quality_gate 汇总数据

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-quality-gate-infrastructure*
*Context gathered: 2026-03-28*
