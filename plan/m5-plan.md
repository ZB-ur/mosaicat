# M5: 代码质量 + QA 团队 + 技术栈约束

## 背景

Pipeline 实际运行中，Coder 产出的代码完全不可用：
- 73KB prompt 单次调用生成 105 个文件，超时 3 次
- 代码有致命 bug（游戏卡死），全程无编译/运行验证
- Reviewer 发现问题但不回退修复，重试从零开始

核心改进思路：**生成 → 执行 → 看报错 → 修 → 再执行**。

## 范围

- ✅ Coder 质量改造（planner/builder + 编译反馈 + 磁盘复用）
- ✅ QALead / Tester / SecurityAuditor Agent
- ✅ IntentConsultant 技术栈声明
- ✅ prompt 去硬编码
- ❌ 不做：DAG 执行引擎、Per-agent LLM 路由、存量项目支持

## 设计决策

### Coder Planner/Builder 分离

**Decision:** 将 Coder 从单次 LLM 调用重写为 Planner + Builder 两阶段
**Why:** 单次调用 73KB prompt 超时，无法验证中间结果
**Alternative:** 增加超时时间（治标不治本）

- Planner 不使用 tool use，输出 code-plan.json（ARTIFACT block）
- Builder 使用 tool use（Read, Write, Bash），逐 module 构建
- 每个 module 后程序化运行 verifyCommand（execSync）
- 失败不阻塞后续 module，最多 2 次修复

### Tester → Coder 修复循环

**Decision:** Tester verdict=fail 时回退到 Coder，注入 test_failures
**Why:** 测试失败需要定向修复，不能全部重来
**Alternative:** 人工介入（太慢）

- 最多 1 轮修复（避免无限回退）
- Coder 检测 test_failures 输入，只重建有失败测试的 module

### SecurityAuditor 两阶段

**Decision:** Phase 1 程序化扫描 + Phase 2 LLM 审查
**Why:** 程序化扫描覆盖已知模式（npm audit、密钥），LLM 覆盖逻辑漏洞
**Alternative:** 纯 LLM 审查（遗漏工具可检测的问题）

## 实施记录

| Phase | 范围 | PR | 状态 |
|---|---|---|---|
| Phase G | Coder 质量改造（planner/builder + 编译反馈 + 磁盘复用） | #268 | ✅ |
| Phase H | QA 团队（QALead + Tester + SecurityAuditor + 修复循环） | #275 | ✅ |
| Phase I | 约束 + 文档（技术栈声明 + prompt 去硬编码 + 文档更新） | TBD | ✅ |

## Pipeline 顺序（full profile）

```
IntentConsultant → Researcher → ProductOwner → UXDesigner → APIDesigner →
UIDesigner → TechLead → Coder → QALead → Tester → SecurityAuditor →
Reviewer → Validator
```

## 新增文件

| 文件 | 职责 |
|---|---|
| `src/agents/code-plan-schema.ts` | CodePlan Zod schema |
| `src/agents/qa-lead.ts` | QALead Agent |
| `src/agents/tester.ts` | Tester Agent |
| `src/agents/security-auditor.ts` | SecurityAuditor Agent |
| `.claude/agents/mosaic/code-planner.md` | Coder Planner prompt |
| `.claude/agents/mosaic/code-builder.md` | Coder Builder prompt |
| `.claude/agents/mosaic/qa-lead.md` | QALead prompt |
| `.claude/agents/mosaic/tester.md` | Tester prompt |
| `.claude/agents/mosaic/security-auditor.md` | SecurityAuditor prompt |
