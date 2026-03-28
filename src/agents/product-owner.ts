import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { assemblePrompt } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';
import { eventBus } from '../core/event-bus.js';

/**
 * Build a JSON schema that includes the constitution_project field
 * alongside the standard artifact/manifest/clarification fields.
 */
function buildOutputSchema(spec: OutputSpec): object {
  return {
    type: 'object',
    properties: {
      artifact: { type: 'string', description: `The full content of ${spec.artifacts[0]}` },
      manifest: { type: 'object', description: `Structured manifest data for ${spec.manifest}` },
      constitution_project: { type: 'string', description: 'Product constraints section of constitution.project.md' },
      clarification: { type: 'string', description: 'Question if you need clarification. Omit if not needed.' },
    },
    required: ['artifact', 'manifest'],
  };
}

export class ProductOwnerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['prd.md'],
      manifest: 'prd.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);
    const outputSchema = buildOutputSchema(spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
      expectedArtifacts: spec.artifacts,
    });
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
      jsonSchema: outputSchema,
    });
    const raw = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', { responseLength: raw.length });
    eventBus.emit('agent:response', this.stage, raw.length);

    let parsed: { artifact?: string; manifest?: unknown; constitution_project?: string; clarification?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (raw.length < 50) {
        throw new Error(`LLM returned non-JSON response too short to be valid (${raw.length} chars)`);
      }
      parsed = { artifact: raw };
    }

    if (parsed.clarification && parsed.clarification.trim().length > 0 && !parsed.artifact) {
      eventBus.emit('agent:clarification', this.stage, parsed.clarification);
      throw new ClarificationNeeded(parsed.clarification);
    }

    if (parsed.artifact) {
      this.writeOutput(spec.artifacts[0], parsed.artifact);
    }

    if (parsed.manifest && spec.manifest) {
      this.writeOutputManifest(spec.manifest, parsed.manifest);
    }

    // Constitution persistence — write if present and non-empty
    if (parsed.constitution_project && parsed.constitution_project.trim().length > 0) {
      this.writeOutput('constitution.project.md', parsed.constitution_project);
    }
  }
}
