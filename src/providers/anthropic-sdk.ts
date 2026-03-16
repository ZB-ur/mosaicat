import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMCallOptions } from '../core/llm-provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicSDKProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    this.model = model ?? process.env.MOSAIC_MODEL ?? DEFAULT_MODEL;
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
