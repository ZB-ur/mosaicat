import type { LLMProvider } from './llm-provider.js';
import { StubProvider } from './llm-provider.js';
import type { PipelineConfig, LLMProviderConfig } from './types.js';
import { ClaudeCLIProvider } from '../providers/claude-cli.js';
import { AnthropicSDKProvider } from '../providers/anthropic-sdk.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';

/**
 * Create the default LLM provider.
 * Resolution order:
 * 1. pipeline.yaml llm.default (if config provided)
 * 2. MOSAIC_PROVIDER env var
 * 3. Auto-detect: ANTHROPIC_API_KEY → anthropic-sdk, else → claude-cli
 */
export function createProvider(config?: PipelineConfig): LLMProvider {
  // 1. Try config-based resolution
  if (config?.llm) {
    const defaultName = config.llm.default;
    const providerConfig = config.llm.providers[defaultName];
    if (providerConfig) {
      return instantiateProvider(defaultName, providerConfig);
    }
  }

  // 2. Env var override
  let providerType = process.env.MOSAIC_PROVIDER;
  if (!providerType) {
    // 3. Auto-detect
    providerType = process.env.ANTHROPIC_API_KEY ? 'anthropic-sdk' : 'claude-cli';
  }

  switch (providerType) {
    case 'stub':
      return new StubProvider();
    case 'claude-cli':
      return new ClaudeCLIProvider();
    case 'anthropic-sdk':
      return new AnthropicSDKProvider();
    default:
      throw new Error(`Unknown provider: ${providerType}. Use "stub", "claude-cli", or "anthropic-sdk".`);
  }
}

/**
 * Create a specific named provider from the config pool.
 * Used for future per-agent routing.
 */
export function createProviderByName(name: string, config: PipelineConfig): LLMProvider {
  if (!config.llm?.providers[name]) {
    throw new Error(`Provider "${name}" not found in pipeline.yaml llm.providers`);
  }
  return instantiateProvider(name, config.llm.providers[name]);
}

function instantiateProvider(name: string, providerConfig: LLMProviderConfig): LLMProvider {
  switch (providerConfig.type) {
    case 'claude-cli':
      return new ClaudeCLIProvider();

    case 'anthropic-sdk':
      return new AnthropicSDKProvider(
        providerConfig.api_key_env ? process.env[providerConfig.api_key_env] : undefined,
        providerConfig.model,
      );

    case 'openai-compatible': {
      const apiKeyEnv = providerConfig.api_key_env;
      const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
      if (!apiKey) {
        throw new Error(
          `Provider "${name}" requires env var ${apiKeyEnv} to be set`
        );
      }
      if (!providerConfig.base_url) {
        throw new Error(`Provider "${name}" requires base_url`);
      }
      if (!providerConfig.model) {
        throw new Error(`Provider "${name}" requires model`);
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseUrl: providerConfig.base_url,
        model: providerConfig.model,
      });
    }

    default:
      throw new Error(`Unknown provider type "${providerConfig.type}" for provider "${name}"`);
  }
}
