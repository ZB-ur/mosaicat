import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMCallOptions, LLMResponse, LLMUsage } from '../core/llm-provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;

// Cost per million tokens (USD) by model prefix
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-opus': { input: 15, output: 75 },
};

function estimateCost(model: string, usage: { input_tokens: number; output_tokens: number }): number | undefined {
  const pricing = Object.entries(MODEL_PRICING).find(([prefix]) => model.startsWith(prefix));
  if (!pricing) return undefined;
  const [, rates] = pricing;
  return (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1_000_000;
}

export class AnthropicSDKProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    this.model = model ?? process.env.MOSAIC_MODEL ?? DEFAULT_MODEL;
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const usage: LLMUsage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: (message.usage as unknown as Record<string, number>).cache_creation_input_tokens,
      cache_read_input_tokens: (message.usage as unknown as Record<string, number>).cache_read_input_tokens,
      cost_usd: estimateCost(this.model, message.usage),
    };

    return { content, usage };
  }
}
