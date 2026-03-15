import type { LLMProvider, LLMCallOptions } from './types.js';

export type { LLMProvider, LLMCallOptions };

export function createLLMProvider(type: 'claude-cli' | 'stub' = 'stub'): LLMProvider {
  // Phase 1: always return stub provider
  // Phase 2: switch on type to return ClaudeCLIProvider
  return new StubProvider();
}

class StubProvider implements LLMProvider {
  async call(options: LLMCallOptions): Promise<string> {
    return `[Stub LLM Response] Received prompt with ${options.userPrompt.length} chars`;
  }
}
