export interface LLMCallOptions {
  systemPrompt?: string;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd?: number;
}

export interface LLMResponse {
  content: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;
}

export class StubProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: '[stub] LLM response placeholder' };
  }
}
