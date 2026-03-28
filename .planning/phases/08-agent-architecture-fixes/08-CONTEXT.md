# Phase 8: Agent Architecture Fixes - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the wiring so every agent's tool-use, output format, constitution persistence, manifest validation, and hook system works correctly. This is the foundation all downstream quality improvements (Phase 9-12) depend on.

Requirements: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06

</domain>

<decisions>
## Implementation Decisions

### Tool-use vs Structured Output (AGENT-01, AGENT-02)
- **D-01:** 新建 `ToolUseAgent extends BaseAgent` 作为 tool-use 模式的基类，与现有 `LLMAgent`（纯 JSON schema）并列。职责分离：LLMAgent 负责结构化输出，ToolUseAgent 负责工具调用。
- **D-02:** ToolUseAgent 的输出策略为 "tool results + final text" — LLM 自由调工具，最后一次回复的 text 作为 artifact 内容。manifest 由子类自行处理。
- **D-03:** ToolUseAgent 的 allowed_tools 从 `agents.yaml` 的 `allowed_tools` 字段读取（通过 `context.stageConfig.allowed_tools`），与现有配置体系一致。
- **D-04:** Researcher 改为继承 ToolUseAgent，配置 web search 相关工具。

### Constitution Persistence (AGENT-03)
- **Claude's Discretion:** ProductOwner/TechLead 输出的 `constitution_project` 写入磁盘的具体实现方式由 Claude 决定，只要满足：写入路径与 `resume.ts` 中的 `constitution.project.md` 一致，下游 agent 可通过 `context-manager.ts` 加载。

### Output Format Alignment (AGENT-04)
- **Claude's Discretion:** UXDesigner/APIDesigner 的 prompt 与实现矛盾需消除。具体修 prompt 还是修 code 由 Claude 根据实际差异决定，原则是最小改动。

### Manifest Validation & Hooks (AGENT-05, AGENT-06)
- **Claude's Discretion:** 为所有 manifest 类型补齐 Zod schema，写入时校验。激活 post-run hooks（placeholder 检测、F-NNN 覆盖验证）。具体哪些 hook 设为 mandatory vs warning 由 Claude 决定。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Agent Architecture
- `src/agents/llm-agent.ts` — 现有 LLMAgent 基类，ToolUseAgent 的参考实现
- `src/core/agent.ts` — BaseAgent 抽象基类，hook 注册机制
- `src/core/agent-factory.ts` — Agent 实例化 + hook 注册入口
- `src/core/hooks/index.ts` — Hook 注册逻辑，preRun/postRun 分发

### Provider Layer
- `src/core/llm-provider.ts` — LLMProvider 接口，allowedTools 在 LLMCallOptions 中
- `src/providers/claude-cli.ts` — ClaudeCLI provider，已支持 allowedTools
- `src/providers/anthropic-sdk.ts` — AnthropicSDK provider，已支持 tools

### Configuration
- `config/agents.yaml` — 每个 agent 的 allowed_tools、输入输出契约
- `config/pipeline.yaml` — Stage 定义、gate 设置

### Constitution
- `src/core/hooks/constitution-compliance.ts` — 现有 constitution hook（静态 constitution）
- `src/core/resume.ts:113` — constitution.project.md 在 product_owner 输出列表中
- `src/agents/refine-agent.ts:66` — 下游消费 constitution.project.md 的示例

### Manifest & Validation
- `src/core/manifest.ts` — manifest 读写函数
- `src/core/hooks/index.ts:35` — placeholderCheckHook 注册位置

### Existing Tool-use Agents (参考模式)
- `src/agents/coder/coder-builder.ts` — 直接调 provider.call() 带 allowedTools 的模式
- `src/agents/qa-lead.ts:87` — QALead 使用 allowedTools 的示例

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BaseAgent` hook 机制（preRun/postRun）已完整实现，只需正确注册 hook
- `ClaudeCLIProvider` 和 `AnthropicSDKProvider` 的 allowedTools 支持已就绪
- `agents.yaml` 的 `allowed_tools` 字段已定义，只需在 ToolUseAgent 中消费
- 多个现有 hook（placeholderCheckHook、constitutionPostRunHook、traceabilityCheckHook）已实现

### Established Patterns
- 复杂 agent（Coder、Tester）直接 override `run()` 调 `provider.call()` 带 `allowedTools` — ToolUseAgent 应抽取此模式
- `LLMAgent` 的 `getOutputSpec()` 模板方法 — ToolUseAgent 可用类似的 `getToolConfig()` 模板方法
- Hook 按 stage 类型注册（`src/core/hooks/index.ts` 的 switch-case）

### Integration Points
- `agent-factory.ts` 的 `createAgent()` 需要识别哪些 agent 用 ToolUseAgent vs LLMAgent
- `context-manager.ts` 的 `buildContext()` 需确保 constitution.project.md 被加载到下游 agent context
- `prompt-assembler.ts` 可能需要 ToolUseAgent 专用的 prompt 组装逻辑（不含 jsonSchema 输出格式指令）

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-agent-architecture-fixes*
*Context gathered: 2026-03-28*
