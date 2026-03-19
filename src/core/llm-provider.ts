export interface LLMCallOptions {
  systemPrompt?: string;
  /** Tool names the LLM is allowed to invoke (e.g. "Bash(git:*)", "WebSearch", "Read") */
  allowedTools?: string[];
  /** JSON Schema for structured output — LLM must return valid JSON matching this schema */
  jsonSchema?: object;
  /** Path(s) to MCP server config JSON files */
  mcpConfigPaths?: string[];
  /** Maximum dollar amount to spend on this call */
  maxBudgetUsd?: number;
}

export interface LLMResponse {
  content: string;
}

export interface LLMProvider {
  call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;
}

export class StubProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: '[stub] LLM response placeholder' };
  }
}
