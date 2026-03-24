# M6: 优化 + 多 LLM + 代码质量 + QA 团队 + 交付后修复

## 状态：✅ 已完成

M6 所有 Phase (A-J) 已实施完成。涵盖 UIDesigner 优化、多 LLM 支持、Coder 架构重写、QA 团队、骨架-实现架构、冒烟测试、Refine 命令。

---

## 背景

M3 打通了从意图到代码的全链路（10 Agent），但实际运行暴露多个瓶颈：
- UIDesigner 每组件一次 LLM 调用，49 个组件 = 49 次调用（慢且贵）
- 锁定 Claude CLI，无法利用其他 LLM
- Coder 单次 73KB prompt 超时，产出代码无编译验证
- 无 QA 团队（测试、安全审计）
- 代码生成后无修复机制，用户发现问题只能重跑

M6 从优化、质量、可用性三个维度系统性解决这些问题。

---

## 范围

- ✅ UIDesigner 批量生成 + API Spec 裁剪（Phase A）
- ✅ 动态设计风格推荐（Phase B）
- ✅ 意图澄清 UX 优化（Phase C）
- ✅ 多 LLM 支持 — 7 家供应商（Phase D）
- ✅ 基础设施加固 + 工件隔离 + Setup 向导（Phase E）
- ✅ GitHub App 多仓库交互选择（Phase F）
- ✅ Coder Planner/Builder 分离 + 编译反馈 + 磁盘复用（Phase G）
- ✅ QA 团队 — QALead + Tester + SecurityAuditor + 修复循环（Phase H）
- ✅ 技术栈约束 + Prompt 去硬编码（Phase I）
- ✅ Coder 骨架-实现架构 + 构建分析 + 冒烟测试 + Refine 命令 + Tester 逐模块拆分（Phase J）
- ❌ 不做：DAG 执行引擎、Per-agent LLM 路由、存量项目支持

---

## Phase 详情

### Phase A: UIDesigner 批量生成 + API Spec 裁剪 (PR #221)

**问题：** 49 个组件 = 49 次 LLM 调用，API spec 全量注入导致 prompt 膨胀。

**方案：**
- 组件按类别分组（atomic/composite/page），每组一次批量 LLM 调用
- API spec trimmer 按 Feature ID 过滤，只注入当前批次相关的 endpoint
- **效果：** LLM 调用从 49 次降至 ~7 次（86% 减少）

### Phase B: 动态设计风格推荐 (PR #224)

**问题：** 设计风格硬编码，不适配不同产品类型。

**方案：**
- LLM 分析 PRD，识别行业/用户/产品上下文
- 生成个性化设计推荐（如企业 vs 消费者风格）
- **效果：** 设计输出更贴合产品定位

### Phase C: 意图澄清 UX 优化 (PR #231)

**问题：** 用户不理解为什么被询问、答案有何影响。

**方案：**
- ClarificationNeeded schema 新增 `context` + `impact` 字段
- 终端显示决策上下文和用户选择的影响说明
- **效果：** 用户知道为什么被问、怎么选

### Phase D: 多 LLM 支持 (PR #239)

**问题：** 锁定 Claude CLI，无法用其他 LLM。

**方案：**
- OpenAI 兼容 provider，覆盖 GPT-4o、Gemini、Qwen、Doubao、Kimi
- 增强 Anthropic SDK provider（结构化输出 + 用量追踪）
- Provider 能力检测 + 多 LLM 池配置
- 新增 DeepSeek + MiniMax provider
- **效果：** 支持 7 家 LLM 供应商，`mosaicat setup` 一键切换

### Phase E: 基础设施加固 + 工件隔离 + Setup 向导 (PR #243)

**问题：** 多次运行工件互相覆盖；首次使用配置复杂；P0 级 bug。

**方案：**
- 工件按 run-id 隔离：`.mosaic/artifacts/{run-id}/`
- 交互式 `mosaicat setup` 向导（选 provider → 输入 API key → 测试连接）
- 修复 timer leak、无限递归、静默错误等 P0 bug
- **效果：** 零配置摩擦 + 多运行不冲突

### Phase F: GitHub App 多仓库交互选择 (PR #251)

**问题：** 多仓库安装 App 时无法选择目标仓库。

**方案：**
- 交互式仓库选择列表
- GitHub App URL 处理增强
- **效果：** 多仓库团队可正常使用 GitHub 模式

### Phase G: Coder 质量改造 — Planner/Builder 分离 (PR #268)

**问题：** 单次 73KB prompt 超时 3 次；代码无编译验证。

**方案：**
- Planner 输出 `code-plan.json`（模块、文件、依赖、构建命令）
- Builder 使用 tool use（Read/Write/Bash）逐模块构建
- 每个模块后 `tsc --noEmit` 编译验证，失败自动修复（最多 2 次）
- 磁盘复用：中断后重跑复用已构建模块
- **效果：** 代码可编译、可构建

### Phase H: QA 团队 (PR #275)

**问题：** 无自动化测试和安全审计。

**方案：**
- **QALead Agent：** 从 tech-spec + code manifest 生成测试计划
- **Tester Agent：** 生成并执行测试代码，产出测试报告
- **SecurityAuditor Agent：** 程序化扫描（npm audit、密钥检测）+ LLM 审查（逻辑漏洞）
- **Tester→Coder 修复循环：** 测试失败注入 `test_failures`，Coder 定向修复（最多 1 轮）
- Pipeline 扩展至 13 个 Agent
- **效果：** 自动化质量保证闭环

### Phase I: 技术栈约束 + Prompt 去硬编码 (PR #279)

**问题：** Prompt 硬编码技术栈；运行时零散 bug。

**方案：**
- IntentConsultant 上下文中声明技术栈约束
- Agent prompt 去除硬编码技术栈引用，改为从上下文读取
- 修复 EISDIR、git 路径、snapshot 可靠性、stage 重试等运行时 bug
- **效果：** 项目可自由指定技术栈

### Phase J: Coder 骨架-实现架构 + 冒烟测试 + Refine (PR #290)

**问题：** Planner/Builder 逐模块隔离导致全局一致性丢失（App.tsx 写 Placeholder，后续模块不更新路由）；无交付后修复机制；Tester 单次 56K prompt 超时。

**方案：**

**骨架-实现架构：**
- 骨架阶段：1 次 LLM 调用写所有项目文件（真实 import/export/路由，stub 实现）
- 实现阶段：逐模块 LLM 调用替换 stub 为真实代码（保持接口不变）
- **效果：** 全局一致性由骨架保证，实现阶段只替换函数体

**构建产物分析（零 LLM 成本）：**
- 检查 `dist/` 存在且非空
- JS bundle 总大小 > 10KB
- 扫描 bundle 中 Placeholder 关键词
- `index.html` 引用了 JS/CSS bundle

**HTTP 冒烟测试：**
- 启动 preview server → 等待端口就绪 → fetch HTML → 检查非空白页
- 自动清理进程

**Refine 命令：**
- `mosaicat refine "反馈描述" [--run <runId>]`
- RefineAgent 读取用户反馈 + code-plan + tech-spec → 诊断根因 → 修复 → 验证
- 自动启动 dev server + 打开浏览器
- 循环：修复 → 验证 → 用户再次反馈 → 直到 "done"

**Tester 逐模块拆分：**
- 按模块分组 test suites，每模块独立 LLM 调用（~5K prompt vs 原 56K）
- 集成/E2E 测试获得更广的源码上下文
- 失败模块不阻塞其他模块
- **效果：** 消除超时，提高测试质量

---

## 设计决策

### 骨架-实现 vs 逐模块隔离构建

**Decision:** 先写完整骨架（所有文件），再逐模块替换 stub 实现
**Why:** 逐模块隔离导致 App.tsx 写 Placeholder，后续模块不更新入口路由，全局一致性丢失
**Alternative:** Prompt 层面补丁（wiring module、entry point 规则）— 治标不治本

### Tester 逐模块拆分 vs 单次调用

**Decision:** 按模块分组 test suites，每模块独立 LLM 调用
**Why:** 单次 56K prompt + 32 test suites 超时 3 次（540s timeout）
**Alternative:** 增加超时时间 — 不解决 prompt 过大导致的质量下降

### Refine 命令 vs 重跑 Pipeline

**Decision:** 新增 `mosaicat refine` 定向修复命令
**Why:** 重跑 pipeline 浪费 30+ 分钟和大量 token；用户发现的问题往往是局部的
**Alternative:** 在 pipeline 中增加更多验证环节 — 不能覆盖所有用户感知问题

### 多 LLM 支持 vs 单一供应商

**Decision:** OpenAI 兼容 provider 覆盖 7 家供应商
**Why:** Claude CLI 不是所有用户都有；不同任务适合不同模型
**Alternative:** 只支持 Anthropic SDK — 限制用户选择

---

## 实施记录

| Phase | 范围 | PR | 状态 |
|---|---|---|---|
| Phase A | UIDesigner 批量生成 + API Spec 裁剪 | #221 | ✅ |
| Phase B | 动态设计风格推荐 | #224 | ✅ |
| Phase C | 意图澄清 UX 优化 | #231 | ✅ |
| Phase D | 多 LLM 支持 | #239 | ✅ |
| Phase E | 基础设施加固 + 工件隔离 + Setup 向导 | #243 | ✅ |
| Phase F | GitHub App 多仓库交互选择 | #251 | ✅ |
| Phase G | Coder Planner/Builder + 编译反馈 + 磁盘复用 | #268 | ✅ |
| Phase H | QA 团队（QALead + Tester + SecurityAuditor） | #275 | ✅ |
| Phase I | 技术栈约束 + Prompt 去硬编码 | #279 | ✅ |
| Phase J | 骨架-实现 + 冒烟测试 + Refine + Tester 拆分 | #290 | ✅ |

---

## Pipeline 顺序（M6 完成后，full profile）

```
IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner →
UIDesigner → TechLead → Coder → QALead → Tester → SecurityAuditor →
Reviewer → Validator
```

附加命令：`mosaicat refine` — pipeline 外的交付后修复循环。

---

## 新增/重写文件汇总

| 文件 | 操作 | Phase |
|---|---|---|
| `src/agents/code-plan-schema.ts` | 新建 (G) + 扩展 smokeTest (J) | G, J |
| `src/agents/coder.ts` | 新建 (G) + 重写为骨架-实现 (J) | G, J |
| `src/agents/qa-lead.ts` | 新建 | H |
| `src/agents/tester.ts` | 新建 (H) + 逐模块拆分 (J) | H, J |
| `src/agents/security-auditor.ts` | 新建 | H |
| `src/agents/refine-agent.ts` | 新建 | J |
| `src/core/artifact.ts` | 扩展 (findLatestRun, loadFromRun) | J |
| `src/core/preview-strategy.ts` | 新建 | J |
| `src/core/refine-runner.ts` | 新建 | J |
| `.claude/agents/mosaic/code-planner.md` | 新建 (G) + 重写 (J) | G, J |
| `.claude/agents/mosaic/code-builder.md` | 新建 (G) + 重写为 implement (J) | G, J |
| `.claude/agents/mosaic/code-skeleton.md` | 新建 | J |
| `.claude/agents/mosaic/qa-lead.md` | 新建 | H |
| `.claude/agents/mosaic/tester.md` | 新建 (H) + 重写 (J) | H, J |
| `.claude/agents/mosaic/security-auditor.md` | 新建 | H |
| `.claude/agents/mosaic/refine.md` | 新建 | J |
| `providers/openai-compatible.ts` | 新建 | D |
| `providers/deepseek.ts` | 新建 | D |
| `providers/minimax.ts` | 新建 | D |
| `core/llm-setup.ts` | 新建 | E |

---

## 关键指标

| 指标 | M3 结束时 | M6 完成后 |
|---|---|---|
| Agent 数量 | 10 | 13 (+ QALead, Tester, SecurityAuditor) |
| LLM 供应商 | 1 (Claude CLI) | 7 (Claude, OpenAI, Gemini, DeepSeek, Qwen, Doubao, Kimi, MiniMax) |
| UIDesigner 调用次数 | ~49 | ~7 (86% 减少) |
| 代码编译验证 | 无 | 每模块 + 骨架阶段 |
| 构建产物检查 | 无 | 静态分析 + HTTP 冒烟 |
| 测试覆盖 | 无 | 自动生成 + 执行 + 报告 |
| 安全审计 | 无 | 程序化 + LLM 双阶段 |
| 交付后修复 | 重跑 pipeline | `mosaicat refine` 定向修复 |
| Pipeline profile | 3 | 3 (不变) |
| 验证 check | 8 | 8 (不变) |
