import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { parseResponse } from '../core/response-parser.js';
import { eventBus } from '../core/event-bus.js';

export abstract class LLMAgent extends BaseAgent {
  abstract getOutputSpec(): OutputSpec;

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
      expectedArtifacts: spec.artifacts,
    });
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });
    const raw = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    const parsed = parseResponse(raw, spec.artifacts, spec.manifest);

    // Clarification signal
    if (parsed.clarification) {
      eventBus.emit('agent:clarification', this.stage, parsed.clarification);
      throw new ClarificationNeeded(parsed.clarification);
    }

    // Write artifacts
    for (const [name, content] of parsed.artifacts) {
      this.writeOutput(name, content);
    }

    // Write manifest
    if (parsed.manifest) {
      this.writeOutputManifest(parsed.manifest.name, parsed.manifest.data);
    }
  }
}
