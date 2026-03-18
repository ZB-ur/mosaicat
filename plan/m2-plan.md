# Mosaicat Milestone 2 — 可观测性 + 产出交付 + 审批反馈

> **状态: COMPLETE** — 所有 Track + Phase 7-9 已完成并合并。Milestone 2 关闭。

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
| `src/core/git-publisher.ts` | T3 | GitHub API 封装（纯 API，无本地 git）：分支、commit、push、Draft PR |
| `src/core/issue-manager.ts` | T4 | Stage/Step Issue 生命周期管理 |
| `src/core/pr-body-generator.ts` | T5 | PR body 生成：截图、预览链接、token 统计 |

## 关键接口变更

| 变更 | 影响范围 |
|------|----------|
| `LLMProvider.call()` 返回 `LLMResponse` (非 `string`) | 所有 provider + agent + 测试 |
| `InteractionHandler.onManualGate()` 返回 `GateResult` (非 `boolean`) | 所有 handler + orchestrator + 测试 |
| `GitPlatformAdapter` 新增 `createPR()` / `markPRReady()` | GitHub adapter + 测试 mock |
| `DeferredInteractionHandler.reject()` 接受 feedback + retryComponents | RunManager + MCP tools |

## 后续 Phase 记录

| Phase | 目标 | PR | 状态 |
|-------|------|----|------|
| Phase 7 | GitPublisher API 化（去除本地 git 依赖） | #120 | :white_check_mark: Done |
| Phase 8 | PR Review 审批流程（替代 Issue 审批） | #127 | :white_check_mark: Done |
| Phase 9 | GitHub App Bot 认证（零配置 GitHub 模式） | #135 | :white_check_mark: Done |

### Phase 7-8 接口变更

| 变更 | 影响范围 |
|------|----------|
| `GitPlatformAdapter` 新增 Git Data API（getRef, createRef, createBlob, createTree, createCommit） | GitHub adapter + git-publisher |
| `GitPlatformAdapter` 新增 PR Review API（listReviews, listReviewComments） | GitHub adapter + interaction-handler |
| `GitPublisher` 改为纯 API 模式，不使用本地 git | orchestrator + 测试 |
| `GitHubInteractionHandler` 新增 PR review 审批流程 | orchestrator + security |

### Phase 9: GitHub App Bot 认证

**问题**：个人 token 创建 PR → 用户是 author → 无法 approve 自己的 PR。且需 3 个环境变量。

**方案**：GitHub App installation token（PR author = `mosaicat[bot]`）+ OAuth Device Flow（用户身份）+ Cloudflare Worker 后端（签发 token）。不保留 legacy 个人 token 模式——只有 App 模式能解决 author ≠ reviewer 的根本问题。

**新增模块**：

| 文件 | 职责 |
|------|------|
| `src/auth/types.ts` | AuthConfig, CachedAuth, InstallationInfo |
| `src/auth/auth-store.ts` | `~/.mosaicat/auth.json` 持久化 |
| `src/auth/oauth-device-flow.ts` | GitHub OAuth Device Flow |
| `src/auth/token-service.ts` | 后端 API 通信（installations + token 交换） |
| `src/auth/resolve-auth.ts` | 认证编排 + git remote 自动匹配 |
| `backend/src/index.ts` | Cloudflare Worker 路由（Hono） |
| `backend/src/auth.ts` | JWT 签名 + installation token 交换 |

**接口变更**：

| 变更 | 影响范围 |
|------|----------|
| `loadSecurityConfig()` 签名改为 `(config, initiatorLogin?)` | security + orchestrator + run-manager |
| 删除 `validateGitHubEnv()`、`createGitHubAdapter()` | 所有调用方改为 `resolveGitHubAuth()` + `createGitHubAdapterFromAuth()` |
| `GitHubAdapter` 构造函数接受 `TokenProvider`（支持自动刷新） | adapter + 测试 mock |
| `index.ts` 新增 `login` / `logout` 命令 | CLI 入口 |

### Phase 9 后续优化（Step 9-12）

| Step | 改动 | 文件 |
|------|------|------|
| Step 9 | Clarification UX 优化：GitHub PR 评论展示预制选项，CLI 增强提示文案 | interaction-handler, github-interaction-handler, cli-progress |
| Step 10 | Stage issue 内容丰富化：执行指标、commit 关联、clarification/rejection 标记 | security, orchestrator, git-publisher |
| Step 11 | GitPublisher 修复：目录输出（components/、previews/）展开为具体文件 | git-publisher |
| Step 12 | Stage issue 全面重设计：manifest 摘要、可点击 artifact 链接、过程记录、可折叠指标 | security, orchestrator, manifest |

**新增导出**：
- `manifest.ts`: `extractManifestSummary()` — 按 schema 提取人类可读摘要
- `security.ts`: `buildStageIssueTitle()`, `buildSummaryIssueTitle()` — 可读的 issue 标题

## 验证

- `npm run build` 通过
- 378 tests / 56 test files（367 passed, 11 failed in 7 files — pre-existing：e2e + dist 过期 + screenshot-renderer）

## Milestone 2 总结

**关键成果**：
- **Token 可观测性** — 每阶段 + 总计 token/费用实时显示
- **GitHub PR 全流程** — 纯 API 模式（无本地 git 副作用）+ Draft PR → Review → Approve
- **PR Review 审批** — 替代 Issue 审批，用户标准 GitHub Review 操作
- **GitHub App Bot 认证** — 零配置，PR author = mosaicat[bot]，用户可自审批
- **Stage Issue 富信息** — manifest 摘要、commit 链接、截图嵌入、可折叠执行指标

**新增模块**：11 个文件（4 core + 5 auth + 2 backend）

**接口影响**：
- `LLMProvider.call()` 返回 `LLMResponse`（含 usage）而非 `string`
- `InteractionHandler.onManualGate()` 返回 `GateResult`（含 feedback）而非 `boolean`
- `GitPlatformAdapter` 新增 Git Data API + PR Review API + PR Create/Ready
- `GitHubAdapter` 构造函数接受 `TokenProvider`（支持 App token 自动刷新）
- 删除 `validateGitHubEnv()`，统一为 `resolveGitHubAuth()`
