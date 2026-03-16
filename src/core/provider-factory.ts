import type { LLMProvider } from './llm-provider.js';
import { StubProvider } from './llm-provider.js';
import { ClaudeCLIProvider } from '../providers/claude-cli.js';

export function createProvider(): LLMProvider {
  const providerType = process.env.MOSAIC_PROVIDER ?? 'claude-cli';

  switch (providerType) {
    case 'stub':
      return new StubProvider();
    case 'claude-cli':
      return new ClaudeCLIProvider();
    default:
      throw new Error(`Unknown provider: ${providerType}. Use "stub" or "claude-cli".`);
  }
}
