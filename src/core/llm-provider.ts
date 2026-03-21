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
  /** Override the model for this specific call */
  model?: string;
  /** LLM temperature (0-1). Lower = more deterministic. */
  temperature?: number;
  /** Timeout in milliseconds for this specific call. Overrides provider default. */
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string;
  /** The model that actually processed the request */
  model?: string;
  /** Token usage for cost tracking */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;
}

export class StubProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: '[stub] LLM response placeholder' };
  }
}
