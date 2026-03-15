import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import PQueue from 'p-queue';
import type { LLMProvider } from '../core/llm-provider.js';

const execAsync = promisify(exec);

export class ClaudeCLIProvider implements LLMProvider {
  private queue = new PQueue({ concurrency: 1 });

  async call(prompt: string): Promise<string> {
    return this.queue.add(async () => {
      const { stdout } = await execAsync(`claude --print "${prompt.replace(/"/g, '\\"')}"`);
      return stdout.trim();
    }) as Promise<string>;
  }
}
