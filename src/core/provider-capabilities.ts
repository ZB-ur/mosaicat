export interface ProviderCapabilities {
  /** Supports jsonSchema in LLMCallOptions */
  structuredOutput: boolean;
  /** Supports allowedTools in LLMCallOptions */
  toolUse: boolean;
  /** Supports mcpConfigPaths in LLMCallOptions */
  mcpConfig: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Quality of Chinese language output */
  chineseQuality: 'high' | 'medium' | 'low';
}

const CAPABILITY_MAP: Record<string, ProviderCapabilities> = {
  'claude-cli': {
    structuredOutput: true,
    toolUse: true,
    mcpConfig: true,
    maxContextTokens: 200_000,
    chineseQuality: 'high',
  },
  'anthropic-sdk': {
    structuredOutput: true,
    toolUse: true,
    mcpConfig: false,
    maxContextTokens: 200_000,
    chineseQuality: 'high',
  },
};

const MODEL_OVERRIDES: Record<string, Partial<ProviderCapabilities>> = {
  'gpt-4o': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 128_000,
    chineseQuality: 'medium',
  },
  'gpt-4o-mini': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 128_000,
    chineseQuality: 'medium',
  },
  'qwen-max': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 32_000,
    chineseQuality: 'high',
  },
  'doubao-pro-256k': {
    structuredOutput: false,
    toolUse: false,
    maxContextTokens: 256_000,
    chineseQuality: 'high',
  },
  'moonshot-v1-128k': {
    structuredOutput: false,
    toolUse: false,
    maxContextTokens: 128_000,
    chineseQuality: 'high',
  },
  'gemini-2.5-pro': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 1_000_000,
    chineseQuality: 'medium',
  },
  'deepseek-chat': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 64_000,
    chineseQuality: 'high',
  },
  'MiniMax-Text-01': {
    structuredOutput: true,
    toolUse: true,
    maxContextTokens: 1_000_000,
    chineseQuality: 'high',
  },
};

const DEFAULT_OPENAI_COMPATIBLE: ProviderCapabilities = {
  structuredOutput: false,
  toolUse: false,
  mcpConfig: false,
  maxContextTokens: 32_000,
  chineseQuality: 'medium',
};

/**
 * Get the capabilities of a provider type + model combination.
 * Used for defensive checks before dispatching work to a provider.
 */
export function getCapabilities(type: string, model?: string): ProviderCapabilities {
  // Direct type match (claude-cli, anthropic-sdk)
  if (CAPABILITY_MAP[type]) {
    return CAPABILITY_MAP[type];
  }

  // OpenAI-compatible: start with defaults, overlay model-specific overrides
  if (type === 'openai-compatible') {
    const base = { ...DEFAULT_OPENAI_COMPATIBLE };
    if (model && MODEL_OVERRIDES[model]) {
      return { ...base, ...MODEL_OVERRIDES[model] };
    }
    return base;
  }

  // Unknown provider type — conservative defaults
  return DEFAULT_OPENAI_COMPATIBLE;
}
