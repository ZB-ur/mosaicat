import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';

/**
 * High-autonomy Coder Agent.
 *
 * Unlike LLMAgent which uses --json-schema for structured output,
 * the Coder uses tool use (Read, Write, Bash, Agent) to generate code files,
 * then returns a manifest summarizing what was produced.
 *
 * The agent reads tech-spec → plans modules → writes code files →
 * self-verifies (compile/lint) → outputs code.manifest.json.
 */
export class CoderAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['code/'],
      manifest: 'code.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    // Coder uses allowedTools for autonomous code generation
    // The LLM will use tools to write files, then return the manifest as JSON
    const autonomy = context.task.autonomy;
    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
      allowedTools: autonomy?.allowed_tools,
      maxBudgetUsd: autonomy?.max_budget_usd,
      jsonSchema: {
        type: 'object',
        properties: {
          manifest: {
            type: 'object',
            description: 'The code.manifest.json summarizing all generated files',
            properties: {
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    module: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['path', 'module', 'description'],
                },
              },
              modules: { type: 'array', items: { type: 'string' } },
              covers_tasks: { type: 'array', items: { type: 'string' } },
              covers_features: { type: 'array', items: { type: 'string' } },
            },
            required: ['files', 'modules', 'covers_tasks', 'covers_features'],
          },
        },
        required: ['manifest'],
      },
    });
    const raw = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Parse manifest from response
    let parsed: { manifest?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.agent(this.stage, 'warn', 'llm:json-parse-fallback', {
        rawLength: raw.length,
      });
      parsed = {};
    }

    // Write manifest
    if (parsed.manifest) {
      this.writeOutputManifest('code.manifest.json', parsed.manifest);
    }
  }
}
