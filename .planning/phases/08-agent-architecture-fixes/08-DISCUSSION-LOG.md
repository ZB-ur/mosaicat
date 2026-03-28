# Phase 8: Agent Architecture Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 08-agent-architecture-fixes
**Areas discussed:** Tool-use vs structured output mode

---

## Tool-use vs Structured Output Mode

### Q1: LLMAgent 如何支持 tool-use？

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-mode LLMAgent | LLMAgent.run() 检查 allowed_tools：有 → tool-use；无 → jsonSchema。最少改动。 | |
| 拆分两个基类 | 新建 ToolUseAgent extends BaseAgent，LLMAgent 保持纯 JSON。职责更清晰。 | ✓ |
| Researcher 直接 override | 只改 Researcher，override run() 直接调 provider.call()。最小改动但不通用。 | |

**User's choice:** 拆分两个基类
**Notes:** 用户偏好职责分离，接受多一个抽象层的代价。

### Q2: ToolUseAgent 的输出解析策略？

| Option | Description | Selected |
|--------|-------------|----------|
| Tool results + final text | LLM 自由调工具，最后回复的 text 作为 artifact。manifest 由子类处理。 | ✓ |
| Tool results + jsonSchema | 工具调用后再做一次 jsonSchema 调用汇总。两次 LLM 调用，费用翻倍。 | |
| Agent 子类自定义 | ToolUseAgent 只提供调用能力，输出解析完全由子类实现。 | |

**User's choice:** Tool results + final text
**Notes:** 最简单方案，避免双倍 LLM 调用成本。

### Q3: ToolUseAgent 的 allowed_tools 来源？

| Option | Description | Selected |
|--------|-------------|----------|
| 从 agents.yaml 读 | 从 context.stageConfig.allowed_tools 读取，与现有配置体系一致。 | ✓ |
| 子类声明 | 每个子类 override getTools() 返回工具列表。类型安全但配置分散。 | |

**User's choice:** 从 agents.yaml 读
**Notes:** 与现有配置体系一致，新 agent 只需改 yaml。

### Follow-up: 子类 prompt 会不会膨胀？

**User's concern:** 按这个实现，子类的 prompt 会不会膨胀得比较大？
**Response:** 不会。工具定义由 provider 在 API 层注入（不占 prompt text），工具调用结果在 conversation history 中累积（provider 层面管理）。ToolUseAgent 的 prompt 模板实际上比 LLMAgent 更简洁，因为不需要 jsonSchema 输出格式指令。
**User's reaction:** 解释清楚，继续。

---

## Claude's Discretion

- Constitution persistence (AGENT-03): 实现方式由 Claude 决定
- Output format alignment (AGENT-04): 修 prompt 还是修 code 由 Claude 决定
- Manifest validation & hooks (AGENT-05/06): 哪些 hook mandatory vs warning 由 Claude 决定

## Deferred Ideas

None — discussion stayed within phase scope
