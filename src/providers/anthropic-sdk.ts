import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicSDKProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    this.model = model ?? process.env.MOSAIC_MODEL ?? DEFAULT_MODEL;
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.model;

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options?.systemPrompt) {
      params.system = options.systemPrompt;
    }

    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    // Structured output via tool_use pattern:
    // Define a tool whose input_schema matches the desired output,
    // force the model to use it, then extract the JSON from the tool call.
    if (options?.jsonSchema) {
      params.tools = [{
        name: 'structured_output',
        description: 'Return the structured response',
        input_schema: options.jsonSchema as Anthropic.Tool.InputSchema,
      }];
      params.tool_choice = { type: 'tool', name: 'structured_output' };
    }

    const message = await this.client.messages.create(params);

    // Extract content: prefer tool_use blocks for structured output, then text blocks
    let content: string;
    const toolUseBlock = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (toolUseBlock) {
      content = JSON.stringify(toolUseBlock.input);
    } else {
      content = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }

    const result: LLMResponse = {
      content,
      model: message.model,
    };

    if (message.usage) {
      result.usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    }

    return result;
  }
}
