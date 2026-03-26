# Mosaicat v2 — Core Engine Rewrite

## What This Is

Mosaicat 是一个 AI 多 Agent 流水线系统：用户给一条指令，经过最多 13 个 Agent 串行处理，产出从需求文档到设计稿到 API 规范到完整代码的交付物。当前版本（v1）功能完整但积累了显著的架构债务和代码质量问题。本次重写聚焦核心引擎层和 Agent 实现层，保留稳定接口和领域资产。

## Core Value

Pipeline 引擎的可靠性和可维护性 — 每个 Agent 的输入输出契约必须被严格执行，错误必须可见，状态必须可追踪。

## Requirements

### Validated

已有功能，由现有稳定代码支撑，本次保留不重写：

- ✓ Pipeline 状态机引擎（`pipeline.ts`） — existing
- ✓ Agent 基类抽象（`agent.ts`、`llm-agent.ts`） — existing
- ✓ GitHub App 认证（`auth/*`） — existing
- ✓ Git PR 发布流程（`git-publisher.ts`） — existing
- ✓ GitHub 交互审批（`github-interaction-handler.ts`） — existing
- ✓ GitHub 适配器（`adapters/github.ts`） — existing
- ✓ Playwright 截图渲染（`screenshot-renderer.ts`） — existing
- ✓ MCP Server 框架（`mcp/server.ts`） — existing
- ✓ 三种 Pipeline Profile（design-only / full / frontend-only） — existing
- ✓ 13 Agent 完整流水线（IntentConsultant → Validator） — existing
- ✓ Agent Prompt 定义和配置（`.claude/agents/mosaic/*.md`、`config/*.yaml`） — existing

### Active

本次重写的目标需求：

- [x] Orchestrator 用迭代循环替代递归 `executeStage`，消除栈溢出风险 — Validated in Phase 3: Execution Engine
- [x] Orchestrator 的 Tester→Coder 修复循环从索引操作改为独立方法 — Validated in Phase 3: Execution Engine
- [x] Artifact 层从全局可变状态改为 `ArtifactStore` 实例，按 run 隔离 — Validated in Phase 2: Foundation Layer
- [x] Coder Agent 从 1312 行单文件拆分为 Planner / Builder / BuildVerifier / SmokeRunner — Validated in Phase 4: Coder Decomposition
- [x] Evolution Engine 消灭 9 个 silent catch，引入统一错误处理（log + fallback） — Validated in Phase 2: Foundation Layer
- [x] Validator 消灭 7 个 silent catch，对损坏的 manifest 返回显式 "unreadable" 状态 — Validated in Phase 2: Foundation Layer
- [x] Context Manager 在 prompt 文件缺失时 fail-fast 或 log warning，不静默降级 — Validated in Phase 2: Foundation Layer
- [x] Retrying Provider 设有限重试上限（默认 20 次）+ 总耗时熔断器 — Validated in Phase 3: Execution Engine
- [x] 添加优雅关闭处理（SIGINT/SIGTERM → 完成当前 stage 写入后退出） — Validated in Phase 3: Execution Engine
- [x] 补齐 resume 流程集成测试（覆盖 `resumeRun()`、`--from` stage reset、artifact cleanup） — Validated in Phase 1: Test Infrastructure Hardening
- [x] 补齐 Coder shell 命令执行路径测试（setup/build/verify/smoke-test） — Validated in Phase 4: Coder Decomposition
- [ ] 统一 console.log 到 logger 模块（消除 30+ 处绕过 logger 的直接输出）
- [x] Orchestrator 可变 config 注入改为 clone-before-mutate 模式 — Validated in Phase 2: Foundation Layer
- [x] SecurityAuditor 排除 .env 文件内容扫描，只检查存在性 — Validated in Phase 2: Foundation Layer

### Out of Scope

- Shell 命令白名单校验 — 当前 YOLO 模式下 LLM 已有完全 shell 权限，校验收益低
- bypassPermissions 移除 — 产品设计就是 YOLO 模式
- Stage 并行执行 — 架构改进但非债务修复，留给未来版本
- 事件总线持久化 — 扩展性需求，非当前优先级
- Pipeline 级费用控制 — 需要计费基础设施，不在重写范围内
- 前端 UI 组件重写 — 输出层不在核心引擎范围内
- Backend (Cloudflare Worker) 重写 — 独立部署单元，无架构债务

## Context

**技术栈**：TypeScript 5.9 / Node.js (ESM) / Vitest / Zod v4 / MCP SDK / Anthropic SDK / Octokit / Playwright

**现有代码规模**：~15,000+ 行 TypeScript，13 个 Agent，6 层架构（CLI → MCP → Orchestration → State Machine → Agent → Provider）

**代码库分析**：`.planning/codebase/` 包含完整的架构、技术栈、规范、测试、集成、问题分析（2026-03-26）

**重写策略**：方案 B — 保留接口契约和稳定胶水层（~30%），重写核心引擎和 Agent 实现（~70%）。保留 `types.ts`、`llm-provider.ts`、`interaction-handler.ts`、`adapters/types.ts` 等接口文件不变，确保重写后的模块与未重写模块无缝对接。

**关键约束**：重写过程中必须保持现有测试通过（渐进式替换，不是一次性切换）。每个 phase 完成后需验证未被修改的模块仍然正常工作。

## Constraints

- **Tech stack**: 保持 TypeScript / Node.js / ESM，不引入新语言或运行时
- **Compatibility**: 重写后的模块必须与保留模块的接口完全兼容（`types.ts` 是契约）
- **Testing**: 每个重写模块必须有对应的单元测试，关键路径（resume、build loop）必须有集成测试
- **Incremental**: 渐进式重写，每个 phase 交付后系统必须可运行

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 方案 B：核心引擎重写 + Agent 层重构 | 全部推倒浪费稳定代码，只修补无法解决交叉依赖的架构问题 | — Pending |
| 保留 bypassPermissions | 产品设计本身就是 YOLO 模式 | ✓ Good |
| Shell 注入面保持现状 | YOLO 模式下 LLM 已有完全 shell 权限，白名单校验收益低 | ✓ Good |
| ArtifactStore 实例化替代全局变量 | 消除并发风险和测试隔离问题，为未来并行 stage 铺路 | ✓ Phase 2 |
| Coder 拆分为 4 个子模块 | 1312 行 6 个职责的单文件无法单独测试和维护 | ✓ Phase 4 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-27 after Phase 4 (Coder Decomposition) completion*
