# Mosaicat Milestone 2 — 可观测性 + 产出交付 + 审批反馈

> **状态: IMPLEMENTED** — 所有 6 个 Track 已完成，代码已合并。

## Track 实施状态

| Track | 目标 | Phase | PR | 状态 |
|-------|------|-------|-----|------|
| T1: Token 可观测 | 每阶段 + 总计显示 token 用量和费用 | M2-Phase 1 | #97 | :white_check_mark: Done |
| T2: 产出链接 | CLI / GitHub 模式下点击直达产出文件 | M2-Phase 2 | #100 | :white_check_mark: Done |
| T3: GitHub PR 流程 | pipeline 产出自动 commit → push → PR | M2-Phase 3 | #103 | :white_check_mark: Done |
| T6: 审批反馈 + 部分重试 | 拒绝时传递反馈，UIDesigner 支持只重做部分组件 | M2-Phase 4 | #107 | :white_check_mark: Done |
| T4: Issue 分层 + Step 模块化 | stage issue → step issue 内聚分组 | M2-Phase 5 | #110 | :white_check_mark: Done |
| T5: PR 预览 | 截图嵌入 PR body + 交互预览链接 | M2-Phase 6 | #113 | :white_check_mark: Done |

## 新增模块

| 文件 | Track | 职责 |
|------|-------|------|
| `src/core/artifact-presenter.ts` | T2 | OSC 8 终端超链接 + GitHub blob URL 格式化 |
| `src/core/git-publisher.ts` | T3 | Git CLI 封装：分支、commit、push、Draft PR |
| `src/core/issue-manager.ts` | T4 | Stage/Step Issue 生命周期管理 |
| `src/core/pr-body-generator.ts` | T5 | PR body 生成：截图、预览链接、token 统计 |

## 关键接口变更

| 变更 | 影响范围 |
|------|----------|
| `LLMProvider.call()` 返回 `LLMResponse` (非 `string`) | 所有 provider + agent + 测试 |
| `InteractionHandler.onManualGate()` 返回 `GateResult` (非 `boolean`) | 所有 handler + orchestrator + 测试 |
| `GitPlatformAdapter` 新增 `createPR()` / `markPRReady()` | GitHub adapter + 测试 mock |
| `DeferredInteractionHandler.reject()` 接受 feedback + retryComponents | RunManager + MCP tools |

## 验证

- `npm run build` 通过
- 274 tests / 46 test files 全部通过
