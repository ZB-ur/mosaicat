import PQueue from 'p-queue';
import type { LLMProvider, LLMCallOptions } from '../core/types.js';

export class ClaudeCLIProvider implements LLMProvider {
  private queue: PQueue;

  constructor() {
    this.queue = new PQueue({ concurrency: 1 });
  }

  async call(options: LLMCallOptions): Promise<string> {
    return this.queue.add(async () => {
      // Phase 1: stub response
      // Phase 2: replace with actual `claude --print` execution
      return `[Stub ClaudeCLI] System: ${options.systemPrompt.slice(0, 50)}... | User: ${options.userPrompt.slice(0, 50)}...`;
    }) as Promise<string>;
  }
}
