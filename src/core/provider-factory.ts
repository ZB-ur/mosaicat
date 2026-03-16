import type { LLMProvider } from './llm-provider.js';
import { StubProvider } from './llm-provider.js';
import { ClaudeCLIProvider } from '../providers/claude-cli.js';
import { AnthropicSDKProvider } from '../providers/anthropic-sdk.js';

export function createProvider(): LLMProvider {
  // Explicit override via env var; otherwise auto-detect
  let providerType = process.env.MOSAIC_PROVIDER;
  if (!providerType) {
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
