# Mosaicat

## What This Is

Mosaicat 是一个 AI 多 Agent 流水线系统：用户给一条指令，经过最多 13 个 Agent 串行处理，产出从需求文档到设计稿到 API 规范到完整代码的交付物。v1.0 完成了核心引擎重写（PipelineLoop + StageExecutor + FixLoopRunner + ShutdownCoordinator），消除了架构债务。当前聚焦产出物质量和运行效率。

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

v1.1 产出物质量提升 & 成本优化：

- [ ] 各阶段自检门控强化：manifest 区分 stub vs 真实实现，不达标产物阻断而非放行
- [ ] Coder 产出质量保障：禁止 placeholder 组件通过验证，支持分批实现
- [ ] QA/Tester 基础设施修复：测试文件规范校验，fix loop 根因诊断能力
- [ ] UI Designer 成本优化：减少不必要的组件生成和截图，控制 token 消耗
- [ ] 意图澄清 & 研究深度提升：结构化用户画像，支持真实网络调研
- [ ] Validator 从 manifest 表面检查升级为产出物内容抽检

### Out of Scope

- Shell 命令白名单校验 — 当前 YOLO 模式下 LLM 已有完全 shell 权限，校验收益低
- bypassPermissions 移除 — 产品设计就是 YOLO 模式
- Stage 并行执行 — 架构改进但非债务修复，留给未来版本
- 事件总线持久化 — 扩展性需求，非当前优先级
- Pipeline 级费用控制 — 需要计费基础设施，不在重写范围内
- 前端 UI 组件重写 — 输出层不在核心引擎范围内
- Backend (Cloudflare Worker) 重写 — 独立部署单元，无架构债务

## Current Milestone: v1.1 产出物质量全面提升 & 产出成本与耗时优化

**Goal:** 提升全链路产出物质量（消灭 placeholder/虚报覆盖率/无效测试），优化 UI 设计成本和 fix loop 效率

**Target features:**
- 强化各阶段自检门控：manifest 必须区分 stub vs 真实实现，阶段产出不达标时阻断而非放行
- Coder 产出质量保障：禁止 placeholder 组件通过验证，分批实现而非一次性全量
- QA/Tester 基础设施修复：测试文件规范校验，fix loop 根因诊断能力
- UI Designer 成本优化：减少不必要的组件生成和截图，控制 token 消耗
- 意图澄清 & 研究深度提升：结构化用户画像，支持真实网络调研
- Validator 从 manifest 表面检查升级为产出物内容抽检

## History

**v1.0 Core Engine Rewrite — SHIPPED 2026-03-28**

- 22,226 行 TypeScript，13 个 Agent，323 commits over 13 days
- 核心引擎完全重写：PipelineLoop + StageExecutor + FixLoopRunner + ShutdownCoordinator
- 零全局状态：所有 production code 使用 RunContext 依赖注入
- Coder: 1312 行 → 226 行 facade + 4 子模块
- Orchestrator: 1080 行 → 208 行 facade + OrchestratorGitOps

## Context

**技术栈**：TypeScript 5.9 / Node.js (ESM) / Vitest / Zod v4 / MCP SDK / Anthropic SDK / Octokit / Playwright

**代码规模**：~22,226 行 TypeScript，13 个 Agent，6 层架构（CLI → MCP → Orchestration → State Machine → Agent → Provider）

**代码库分析**：`.planning/codebase/` 包含完整的架构、技术栈、规范、测试、集成、问题分析（2026-03-26）

**v1.0 产出物质量基线**（run-1774640936546 分析）：code.manifest 虚报 100% 覆盖但实际仅 45%，14/16 test suite 因 .ts/.tsx 扩展名问题全部 crash，fix loop 未能诊断根因，UIDesigner 耗时 39min 占总时长 30%

## Constraints

- **Tech stack**: 保持 TypeScript / Node.js / ESM，不引入新语言或运行时
- **Compatibility**: 重写后的模块必须与保留模块的接口完全兼容（`types.ts` 是契约）
- **Testing**: 每个重写模块必须有对应的单元测试，关键路径（resume、build loop）必须有集成测试
- **Incremental**: 渐进式重写，每个 phase 交付后系统必须可运行

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 方案 B：核心引擎重写 + Agent 层重构 | 全部推倒浪费稳定代码，只修补无法解决交叉依赖的架构问题 | ✓ Good — v1.0 shipped |
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
*Last updated: 2026-03-28 after v1.0 milestone*
