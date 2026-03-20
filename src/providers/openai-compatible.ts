import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';
import { getCapabilities } from '../core/provider-capabilities.js';

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultMaxTokens?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: object;
    strict?: boolean;
  };
}

export class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultMaxTokens: number;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 8192;
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.model;
    const capabilities = getCapabilities('openai-compatible', model);

    const messages: ChatMessage[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    // If jsonSchema requested but provider doesn't support structured output,
    // inject schema into the user prompt as guidance
    let userPrompt = prompt;
    if (options?.jsonSchema && !capabilities.structuredOutput) {
      userPrompt += `\n\nYou MUST respond with valid JSON matching this schema:\n\`\`\`json\n${JSON.stringify(options.jsonSchema, null, 2)}\n\`\`\``;
    }
    messages.push({ role: 'user', content: userPrompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: this.defaultMaxTokens,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    // Structured output via response_format (GPT-4o, Gemini, Qwen support)
    if (options?.jsonSchema && capabilities.structuredOutput) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: options.jsonSchema,
          strict: true,
        },
      } satisfies OpenAIResponseFormat;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`OpenAI-compatible API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string | null };
        finish_reason: string;
      }>;
      model?: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
      };
    };

    if (!data.choices?.[0]?.message?.content) {
      throw new Error('OpenAI-compatible API returned empty response');
    }

    const result: LLMResponse = {
      content: data.choices[0].message.content,
      model: data.model ?? model,
    };

    if (data.usage) {
      result.usage = {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      };
    }

    return result;
  }
}
