import type { LLMProvider } from './llm-provider.js';
import { StubProvider } from './llm-provider.js';
import type { PipelineConfig, LLMProviderConfig } from './types.js';
import { ClaudeCLIProvider } from '../providers/claude-cli.js';
import { AnthropicSDKProvider } from '../providers/anthropic-sdk.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { loadUserLLMConfig } from './llm-config-store.js';
import { RetryingProvider } from './retrying-provider.js';

// Provider metadata for resolving user config → provider instance
const OPENAI_COMPATIBLE_PROVIDERS: Record<string, { baseUrl: string; defaultModel: string }> = {
  'gpt-4o': { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  'gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-pro' },
  'qwen-max': { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max' },
  'doubao': { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-pro-256k' },
  'kimi': { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-128k' },
  'deepseek': { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  'minimax': { baseUrl: 'https://api.minimax.chat/v1', defaultModel: 'MiniMax-Text-01' },
};

/**
 * Create the default LLM provider.
 * Resolution order:
 * 1. ~/.mosaicat/llm-config.json (user setup wizard)
 * 2. pipeline.yaml llm.default (if config provided)
 * 3. MOSAIC_PROVIDER env var
 * 4. Auto-detect: ANTHROPIC_API_KEY → anthropic-sdk, else → claude-cli
 */
export function createProvider(config?: PipelineConfig): LLMProvider {
  let provider: LLMProvider;

  // 1. User-level config from `mosaicat setup`
  const userConfig = loadUserLLMConfig();
  if (userConfig) {
    provider = createFromUserConfig(userConfig, config);
  } else if (config?.llm) {
    // 2. Try config-based resolution
    const defaultName = config.llm.default;
    const providerConfig = config.llm.providers[defaultName];
    if (providerConfig) {
      provider = instantiateProvider(defaultName, providerConfig);
    } else {
      provider = resolveFromEnv();
    }
  } else {
    provider = resolveFromEnv();
  }

  // Wrap with retry logic (StubProvider excluded — no real network)
  if (provider instanceof StubProvider) return provider;
  return new RetryingProvider(provider);
}

function resolveFromEnv(): LLMProvider {
  // 3. Env var override
  let providerType = process.env.MOSAIC_PROVIDER;
  if (!providerType) {
    // 4. Auto-detect
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
      throw new Error(`Unknown provider: ${providerType}. Use "stub", "claude-cli", or "anthropic-sdk", or run "mosaicat setup".`);
  }
}

/**
 * Create provider from user-level config (from `mosaicat setup`).
 * Falls back to pipeline.yaml for base_url/model if needed.
 */
function createFromUserConfig(
  userConfig: ReturnType<typeof loadUserLLMConfig> & {},
  pipelineConfig?: PipelineConfig,
): LLMProvider {
  const name = userConfig.provider;

  if (name === 'claude-cli') {
    return new ClaudeCLIProvider();
  }

  if (name === 'anthropic-sdk') {
    return new AnthropicSDKProvider(userConfig.apiKey, userConfig.model);
  }

  // OpenAI-compatible: resolve from known providers or pipeline.yaml
  const known = OPENAI_COMPATIBLE_PROVIDERS[name];
  if (known && userConfig.apiKey) {
    return new OpenAICompatibleProvider({
      apiKey: userConfig.apiKey,
      baseUrl: known.baseUrl,
      model: userConfig.model ?? known.defaultModel,
    });
  }

  // Try pipeline.yaml config pool with user's API key injected
  const poolConfig = pipelineConfig?.llm?.providers[name];
  if (poolConfig && poolConfig.type === 'openai-compatible' && userConfig.apiKey) {
    return new OpenAICompatibleProvider({
      apiKey: userConfig.apiKey,
      baseUrl: poolConfig.base_url!,
      model: userConfig.model ?? poolConfig.model!,
    });
  }

  throw new Error(`Cannot resolve provider "${name}". Run "mosaicat setup" to reconfigure.`);
}

/**
 * Create a specific named provider from the config pool.
 * Used for future per-agent routing.
 */
export function createProviderByName(name: string, config: PipelineConfig): LLMProvider {
  if (!config.llm?.providers[name]) {
    throw new Error(`Provider "${name}" not found in pipeline.yaml llm.providers`);
  }
  const provider = instantiateProvider(name, config.llm.providers[name]);
  if (provider instanceof StubProvider) return provider;
  return new RetryingProvider(provider);
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
          `Provider "${name}" requires env var ${apiKeyEnv} to be set. Or run "mosaicat setup" for guided configuration.`
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
