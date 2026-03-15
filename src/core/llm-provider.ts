export interface LLMCallOptions {
  systemPrompt?: string;
}

export interface LLMProvider {
  call(prompt: string, options?: LLMCallOptions): Promise<string>;
}

export class StubProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<string> {
    return '[stub] LLM response placeholder';
  }
}
