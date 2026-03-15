import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { parseResponse } from '../core/response-parser.js';

export abstract class LLMAgent extends BaseAgent {
  abstract getOutputSpec(): OutputSpec;

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
      expectedArtifacts: spec.artifacts,
    });

    const raw = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });

    const parsed = parseResponse(raw, spec.artifacts, spec.manifest);

    // Clarification signal
    if (parsed.clarification) {
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
