import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt } from '../core/prompt-assembler.js';
/**
 * Output specification for tool-use agents.
 * Same shape as OutputSpec but semantically distinct: tool-use agents
 * produce free-text artifacts (not structured JSON).
 */
export interface ToolUseOutputSpec {
  artifacts: string[];
  manifest?: string;
}

/**
 * Base class for agents that use tool-use mode (allowedTools, no jsonSchema).
 * Sibling to LLMAgent which uses structured JSON output.
 *
 * Key difference from LLMAgent:
 * - provider.call() receives `allowedTools` but NEVER `jsonSchema`
 * - Response is free text (markdown), not structured JSON
 * - Manifest extraction is delegated to subclass via parseManifest()
 */
export abstract class ToolUseAgent extends BaseAgent {
  abstract getToolUseSpec(): ToolUseOutputSpec;

  /**
   * Override in subclass to extract manifest data from the final text response.
   * Return undefined if no manifest data can be parsed.
   */
  protected parseManifest(_finalText: string): unknown | undefined {
    return undefined;
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getToolUseSpec();
    const prompt = assemblePrompt(context, spec);
    const tools = context.task.autonomy?.allowed_tools ?? [];

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
      expectedArtifacts: spec.artifacts,
      mode: 'tool-use',
    });
    this.ctx.eventBus.emit('agent:thinking', this.stage, prompt.length);

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
      allowedTools: tools,
      maxBudgetUsd: context.task.autonomy?.max_budget_usd,
      timeoutMs: 600_000,
    });

    const finalText = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: finalText.length,
    });
    this.ctx.eventBus.emit('agent:response', this.stage, finalText.length);

    // Write primary artifact
    if (spec.artifacts.length > 0) {
      this.writeOutput(spec.artifacts[0], finalText);
    }

    // Let subclass handle manifest parsing from free text
    if (spec.manifest) {
      const manifestData = this.parseManifest(finalText);
      if (manifestData) {
        this.writeOutputManifest(spec.manifest, manifestData);
      }
    }
  }
}
