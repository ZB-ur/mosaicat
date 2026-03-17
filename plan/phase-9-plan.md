# Phase 9: GitHub App Bot 认证

> **状态: IMPLEMENTED** — 零配置 GitHub 模式，Bot 创建 PR，用户标准 Review。

## 问题

当前 GitHub 模式用用户的 personal token 创建 PR → 用户是 PR author → GitHub 不允许 author approve 自己的 PR → PR Review 审批流程无法工作。且需配置 3 个环境变量。

## 解决方案

- Pipeline 用 GitHub App 的 installation token 操作 → PR author 是 `mosaicat[bot]`
- 用户用 OAuth token 识别身份 → 可以正常 Approve/Request Changes
- 后端服务（Cloudflare Worker）持有 App private key，签发 installation token
- 向后兼容：`GITHUB_TOKEN` 环境变量 → legacy 个人 token 模式

## 架构

```
CLI(mosaicat) → Cloudflare Worker(api.mosaicat.dev) → GitHub API
  OAuth token     App private key → installation token
```

## 新增模块

| 文件 | 职责 |
|------|------|
| `src/auth/types.ts` | AuthConfig, CachedAuth, InstallationInfo |
| `src/auth/auth-store.ts` | `~/.mosaicat/auth.json` 持久化 |
| `src/auth/oauth-device-flow.ts` | GitHub OAuth Device Flow |
| `src/auth/token-service.ts` | 后端 API 通信 |
| `src/auth/resolve-auth.ts` | 双模式认证编排 + git remote 自动匹配 |
| `backend/src/index.ts` | Cloudflare Worker 路由 |
| `backend/src/auth.ts` | JWT 签名 + installation token 交换 |

## 改动模块

| 文件 | 变更 |
|------|------|
| `src/adapters/github.ts` | TokenProvider 函数 + `createGitHubAdapterFromAuth()` |
| `src/core/security.ts` | `AuthOverrides` + `detectGitHubAuthMode()` |
| `src/index.ts` | `login`/`logout` 命令 + `resolveGitHubAuth()` |
| `src/core/run-manager.ts` | MCP 入口同步改认证 |
| `src/core/github-interaction-handler.ts` | bot 评论过滤 `[bot]` 后缀 |

## 用户体验

```bash
mosaicat login           # 一次性 OAuth 登录
mosaicat run "..." --github  # 零配置，bot 创 PR，用户 Review
```
