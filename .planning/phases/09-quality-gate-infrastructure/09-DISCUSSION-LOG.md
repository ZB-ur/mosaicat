# Phase 9: Quality Gate Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 09-quality-gate-infrastructure
**Areas discussed:** Stub 检测范围, implementation_status 来源, 阻断策略, Validator 改造

---

## Stub 检测范围

### Q1: Stub 检测用什么方式？

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展 regex 匹配（推荐） | 在现有 placeholder-check 基础上加 pattern：空 div shell、空函数体、return null/undefined、{} 空对象。简单可靠，零依赖。 | |
| AST 解析 | 用 TypeScript compiler API 解析代码 AST，检测空函数体、只有 return null 的函数等。更精确但引入 ts compiler 作为运行时依赖。 | ✓ |
| Claude 决定 | 让 Claude 根据实际代码复杂度决定用哪种方式 | |

**User's choice:** AST 解析
**Notes:** 用户偏好精确检测，接受 TypeScript compiler API 依赖（项目已有 ts 依赖）。

### Q2: AST 检测范围？

| Option | Description | Selected |
|--------|-------------|----------|
| 只扫代码文件（推荐） | AST 只对 Coder/UIDesigner 产出的 .ts/.tsx/.js/.jsx 文件。其他 stage 继续用现有 regex。 | ✓ |
| 所有 artifact 都 AST | 对所有 stage 的所有产出都跑 AST。对 markdown 没意义但保证一致性。 | |

**User's choice:** 只扫代码文件
**Notes:** 务实选择，AST 只对代码有意义。

---

## implementation_status 来源

### Q3: 怎么判定 stub/partial/complete？

| Option | Description | Selected |
|--------|-------------|----------|
| AST 指标组合（推荐） | 函数体行数 < 3 且 return null → stub；有 TODO/FIXME + 部分实现 → partial；其余 → complete。 | ✓ |
| 行数比例 | 按文件行数与函数数量比例判定。简单但不精确。 | |
| Claude 决定 | 让 Claude 根据 AST 指标细节自行设计阈值 | |

**User's choice:** AST 指标组合
**Notes:** 程序化填充，不依赖 LLM 自报告。

---

## 阻断策略

### Q4: 检测到 stub 后怎么处理？

| Option | Description | Selected |
|--------|-------------|----------|
| 分级阻断（推荐） | stub → mandatory fail；partial → warn + 记录；complete → pass。 | |
| 全部阻断 | 只要不是 complete 就阻断 pipeline。最严格。 | ✓ |
| Claude 决定 | 让 Claude 根据实际场景决定哪些情况阻断哪些 warning | |

**User's choice:** 全部阻断
**Notes:** 用户选择最严格策略 — stub 和 partial 都阻断。

---

## Validator 改造

### Q5: 质量数据怎么传递给 Validator？

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展现有 manifest（推荐） | 每个 stage 的 manifest 新增 quality_gate 字段。Validator 汇总所有 manifest 的 quality_gate。 | ✓ |
| 新建 quality artifact | 每个 stage 额外产出 quality-report.json。Validator 读取所有 quality-report。 | |

**User's choice:** 扩展现有 manifest
**Notes:** 与现有架构一致，Validator 已消费 manifest。

---

## Claude's Discretion

- AST 检测的具体阈值细节（如函数体行数阈值的精确数值）
- quality_gate 字段在各 stage manifest 中的具体 Zod schema 设计
- Validator 报告的具体格式和内容

## Deferred Ideas

None — discussion stayed within phase scope
