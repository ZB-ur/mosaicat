import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';

export class ValidatorAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['validation-report.md'],
      // Validator has no manifest output
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    const raw = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Check for clarification (shouldn't happen for validator, but handle defensively)
    const clarificationMatch = raw.match(
      /<!-- CLARIFICATION -->\s*([\s\S]*?)\s*<!-- END:CLARIFICATION -->/
    );
    if (clarificationMatch) {
      throw new ClarificationNeeded(clarificationMatch[1].trim());
    }

    // Extract artifact by delimiter or use full response as fallback
    const artifactPattern = /<!-- ARTIFACT:validation-report\.md -->\s*([\s\S]*?)\s*<!-- END:validation-report\.md -->/;
    const artifactMatch = raw.match(artifactPattern);
    const content = artifactMatch ? artifactMatch[1].trim() : raw.trim();

    this.writeOutput('validation-report.md', content);
  }
}
