# Requirements: Mosaicat v2 Core Engine Rewrite

**Defined:** 2026-03-26
**Core Value:** Pipeline 引擎的可靠性和可维护性 — 错误必须可见，状态必须可追踪

## v1 Requirements

### Test Infrastructure

- [x] **TEST-01**: 消除所有测试文件中的 `as any` 类型转换，创建 typed mock factories (`createTestContext()`, `createMockProvider()`)
- [x] **TEST-02**: 编写 resume 流程集成测试，覆盖 `resumeRun()`、`--from` stage reset、artifact cleanup
- [x] **TEST-03**: 添加 canary 集成测试（使用真实模块除 LLM 外），验证端到端 pipeline 执行
- [x] **TEST-04**: 编写 Coder shell 命令执行路径测试（setup/build/verify/smoke-test）

### Error Handling

- [ ] **ERR-01**: 消灭 Evolution Engine 中 9 个 silent catch 块，替换为 `logger.warn()` + typed fallback
- [ ] **ERR-02**: 消灭 Validator 中 7 个 silent catch 块，对损坏 manifest 返回显式 "unreadable" 状态
- [ ] **ERR-03**: 实现自定义 `Result<T, E>` 类型（~50 行），用于新模块的错误返回
- [x] **ERR-04**: Context Manager 在 prompt 文件缺失时 fail-fast（生产模式）或 log warning（开发模式）

### State Management

- [ ] **STATE-01**: 实现 `ArtifactStore` 类替代 `artifact.ts` 全局可变状态 `currentRunDir`，按 run 实例化
- [x] **STATE-02**: ArtifactStore 提供 bridge pattern 兼容层，使保留模块（BaseAgent 等）无需修改即可工作
- [x] **STATE-03**: Config 在执行前通过 `structuredClone` + `Object.freeze` 冻结，消除可变 config 注入问题
- [x] **STATE-04**: 实现 `RunContext` 对象，聚合 ArtifactStore/Logger/Provider/EventBus/Config/AbortSignal

### Execution Engine

- [x] **EXEC-01**: Orchestrator 用 `while` 迭代循环 + `StageOutcome` 判别联合类型替代递归 `executeStage`
- [x] **EXEC-02**: 提取 Tester→Coder 修复循环为独立 `FixLoopRunner`，消除循环索引操作
- [x] **EXEC-03**: 实现 `StageExecutor`（单 stage 执行 + 重试 + 门控处理）和 `PipelineLoop`（stage 编排）
- [x] **EXEC-04**: RetryingProvider 设有限重试上限（默认 20 次）+ 熔断器（5 次连续失败后 OPEN，30s HALF_OPEN）
- [x] **EXEC-05**: 实现 `ShutdownCoordinator`：SIGINT/SIGTERM → 完成当前 stage artifact 写入后优雅退出

### Coder Decomposition

- [x] **CODER-01**: 从 `coder.ts` 提取 `CoderPlanner` — 负责生成 code-plan.json
- [x] **CODER-02**: 从 `coder.ts` 提取 `CoderBuilder` — 负责骨架生成和模块实现
- [x] **CODER-03**: 从 `coder.ts` 提取 `BuildVerifier` — 负责编译检查和构建修复循环
- [x] **CODER-04**: 从 `coder.ts` 提取 `SmokeRunner` — 负责 HTTP 探测和冒烟测试
- [x] **CODER-05**: `coder.ts` 重写为 thin facade（~200 行），委派到 4 个子模块

### Orchestrator Facade

- [x] **ORCH-01**: 重写 Orchestrator 为 thin facade（< 200 行），创建 RunContext 并委派到 PipelineLoop
- [ ] **ORCH-02**: EventBus 从 singleton 改为实例化，通过 RunContext 传递
- [ ] **ORCH-03**: 统一 30+ 处 `console.log` 到 Logger 模块，消除绕过 logger 的直接输出

### Security

- [ ] **SEC-01**: SecurityAuditor 排除 `.env` 文件内容扫描，只检查存在性

## v2 Requirements

### Performance & Observability

- **PERF-01**: 支持独立 stage 并行执行（如 APIDesigner 和 UXDesigner 可并行）
- **PERF-02**: 事件总线持久化，支持 resume 后事件回放
- **OBS-01**: 结构化 stage 遥测（timing、token usage、retry count、error summary）
- **OBS-02**: Per-stage 错误上下文传播（失败详情、LLM 响应片段、验证错误）

### Resilience

- **RES-01**: Stage 级耗时熔断器（单 stage 运行 > 30min 强制失败）
- **RES-02**: Resume 时 artifact 完整性校验（schema 验证，不仅检查文件存在）

### Cost Control

- **COST-01**: Pipeline 级费用聚合和预算上限

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shell 命令白名单校验 | YOLO 模式设计，LLM 已有完全 shell 权限，白名单收益低 |
| bypassPermissions 移除 | 产品设计本身就是 YOLO 模式 |
| 前端 UI 组件重写 | 输出层不在核心引擎范围内 |
| Backend (Cloudflare Worker) 重写 | 独立部署单元，无架构债务 |
| 通用 Agent 插件系统 | 13-agent pipeline 即产品，添加插件 API 是过度工程化 |
| 分布式/多进程执行 | 无使用场景，单用户单 pipeline 单机器 |
| Auto-healing 泛化 | Tester-Coder 修复循环已覆盖，其他 stage 用简单重试 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |
| TEST-04 | Phase 4 | Complete |
| ERR-01 | Phase 2 | Pending |
| ERR-02 | Phase 2 | Pending |
| ERR-03 | Phase 2 | Pending |
| ERR-04 | Phase 2 | Complete |
| STATE-01 | Phase 2 | Pending |
| STATE-02 | Phase 2 | Complete |
| STATE-03 | Phase 2 | Complete |
| STATE-04 | Phase 2 | Complete |
| EXEC-01 | Phase 3 | Complete |
| EXEC-02 | Phase 3 | Complete |
| EXEC-03 | Phase 3 | Complete |
| EXEC-04 | Phase 3 | Complete |
| EXEC-05 | Phase 3 | Complete |
| CODER-01 | Phase 4 | Complete |
| CODER-02 | Phase 4 | Complete |
| CODER-03 | Phase 4 | Complete |
| CODER-04 | Phase 4 | Complete |
| CODER-05 | Phase 4 | Complete |
| ORCH-01 | Phase 5 | Complete |
| ORCH-02 | Phase 5 | Pending |
| ORCH-03 | Phase 5 | Pending |
| SEC-01 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*
