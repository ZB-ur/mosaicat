# Requirements: Mosaicat

**Defined:** 2026-03-28
**Core Value:** Pipeline 引擎的可靠性和可维护性 — 每个 Agent 的输入输出契约必须被严格执行，错误必须可见，状态必须可追踪。

## Constraints

- **No over-engineering**: 每个改动用最少代码解决实际问题，不为假设性需求设计抽象
- **No code rot**: 修改必须与现有代码风格一致，不引入新的架构概念或命名规范
- **Quality over cost**: 成本优化不得以降低产出质量为代价

## v1.1 Requirements

### Agent 架构修复 (AGENT)

- [x] **AGENT-01**: LLMAgent 的 `allowed_tools` 配置生效，支持 tool use 与结构化输出共存或按 agent 切换模式
- [x] **AGENT-02**: Researcher 改为 tool-use agent（非纯 JSON schema），能实际调用 WebSearch/WebFetch 执行网络搜索
- [x] **AGENT-03**: ProductOwner/TechLead 输出的 `constitution_project` 字段被正确写入磁盘，下游 agent 可消费
- [x] **AGENT-04**: UXDesigner/APIDesigner 输出格式统一（消除 prompt 与实现的矛盾指令）
- [x] **AGENT-05**: 为所有 manifest 类型添加 Zod schema，写入时校验
- [x] **AGENT-06**: 激活 BaseAgent hook 机制，注册关键 post-run hooks（placeholder 检测、F-NNN 覆盖验证）

### 质量门控 (GATE)

- [ ] **GATE-01**: 每个 stage 完成后运行程序化质量检查（stub 检测 + 特性覆盖率），不达标时阻断进入下一 stage
- [ ] **GATE-02**: Coder 输出经过 placeholder 扫描（空壳 div、空函数体、TODO/FIXME、return null），检测到 stub 时标记在 manifest
- [ ] **GATE-03**: code.manifest 每个文件标注 implementation_status（stub / partial / complete），由程序化检查填充
- [ ] **GATE-04**: 跨阶段特性覆盖验证：每个 stage 结束后对比 PRD feature list 与 manifest covers_features
- [x] **GATE-05**: Validator 简化为汇总各 stage 质量检查结果 + 全链路完整性报告

### 测试修复循环 (TEST)

- [ ] **TEST-01**: Tester 运行 vitest 前先执行测试文件预编译检查（tsc --noEmit）
- [ ] **TEST-02**: 测试失败结果分为 3 类：parse/import error、assertion failure、runtime error
- [ ] **TEST-03**: Fix loop 连续 2 轮相同失败集时提前终止并输出停滞报告
- [ ] **TEST-04**: 错误类型映射到修复策略：parse → 修 config，assertion → 修逻辑，import → 修依赖

### 成本优化 (COST)

- [ ] **COST-01**: 每个 stage 的 LLM 调用累计 token 消耗写入 run-metrics.json，CLI 进度显示
- [ ] **COST-02**: UI Designer 组件按功能重要性分级（P0/P1/P2），P2 组件跳过完整 LLM 实现但不降低 P0/P1 质量
- [ ] **COST-03**: AnthropicSDK provider 对共享上下文设置 cache_control，减少重复输入 token

### 意图研究 (INTENT)

- [ ] **INTENT-01**: Researcher 通过 Anthropic web_search 工具执行真实网络搜索（依赖 AGENT-02）
- [ ] **INTENT-02**: IntentConsultant 输出结构化用户画像（年龄段/设备/使用频率/核心痛点）

## Future Requirements (v1.2)

- **COST-04**: Pipeline 级软预算告警（基于 COST-01 数据）
- **TEST-05**: 智能根因诊断策略映射（需多次 v1.1 运行数据调优）
- **AGENT-07**: 激活 run-memory 跨 agent 上下文共享
- **GATE-06**: Reviewer 改为 programmatic + LLM 混合模式（类似 Validator）

## Out of Scope

| Feature | Reason |
|---------|--------|
| LLM-as-judge 评分 | LLM 评估自身输出不可靠，程序化检测更准确且免费 |
| Full AST 分析 | 增加 ~50MB 依赖，regex 可覆盖 95%+ 场景 |
| Pipeline 级费用硬上限 | 中途强制中断导致工件不一致，用软预算 + 告警替代 |
| Stage 并行执行 | 串行是基本架构，仅 security+reviewer 可并行省 5%，ROI 不足 |
| Ensemble 多模型共识 | 2-3x 成本，共识不等于正确，程序化检查更有效 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGENT-01 | Phase 8 | Complete |
| AGENT-02 | Phase 8 | Complete |
| AGENT-03 | Phase 8 | Complete |
| AGENT-04 | Phase 8 | Complete |
| AGENT-05 | Phase 8 | Complete |
| AGENT-06 | Phase 8 | Complete |
| GATE-01 | Phase 9 | Pending |
| GATE-02 | Phase 9 | Pending |
| GATE-03 | Phase 9 | Pending |
| GATE-04 | Phase 9 | Pending |
| GATE-05 | Phase 9 | Complete |
| TEST-01 | Phase 10 | Pending |
| TEST-02 | Phase 10 | Pending |
| TEST-03 | Phase 10 | Pending |
| TEST-04 | Phase 10 | Pending |
| COST-01 | Phase 11 | Pending |
| COST-02 | Phase 11 | Pending |
| COST-03 | Phase 11 | Pending |
| INTENT-01 | Phase 12 | Pending |
| INTENT-02 | Phase 12 | Pending |

**Coverage:**
- v1.1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after roadmap creation*
