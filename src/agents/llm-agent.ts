import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';

/**
 * Build a JSON schema that enforces structured output from the LLM.
 * Schema shape: { artifact: string, manifest?: object, clarification?: string }
 */
function buildOutputSchema(spec: OutputSpec): object {
  const properties: Record<string, object> = {
    artifact: {
      type: 'string',
      description: `The full content of the ${spec.artifacts[0]} artifact`,
    },
  };
  const required = ['artifact'];

  if (spec.manifest) {
    properties.manifest = {
      type: 'object',
      description: `Structured manifest data for ${spec.manifest}`,
    };
    required.push('manifest');
  }

  properties.clarification = {
    type: 'string',
    description: 'If you need user clarification before producing output, put your question here instead of providing artifact/manifest. Leave empty or omit if not needed.',
  };

  return {
    type: 'object',
    properties,
    required,
  };
}

export abstract class LLMAgent extends BaseAgent {
  abstract getOutputSpec(): OutputSpec;

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

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Parse structured JSON response
    let parsed: { artifact?: string; manifest?: unknown; clarification?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fallback: if JSON parsing fails, treat entire response as artifact content
      this.logger.agent(this.stage, 'warn', 'llm:json-parse-fallback', {
        rawLength: raw.length,
      });
      parsed = { artifact: raw };
    }

    // Clarification signal
    if (parsed.clarification && parsed.clarification.trim().length > 0 && !parsed.artifact) {
      eventBus.emit('agent:clarification', this.stage, parsed.clarification);
      throw new ClarificationNeeded(parsed.clarification);
    }

    // Write artifact
    if (parsed.artifact) {
      const artifactName = spec.artifacts[0];
      this.writeOutput(artifactName, parsed.artifact);
    }

    // Write manifest
    if (parsed.manifest && spec.manifest) {
      this.writeOutputManifest(spec.manifest, parsed.manifest);
    }
  }
}
