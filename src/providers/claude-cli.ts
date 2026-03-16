import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import type { LLMProvider, LLMCallOptions } from '../core/llm-provider.js';

const TIMEOUT_MS = 600_000; // 10 minutes — complex stages (ui_designer) need time for large outputs
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export class ClaudeCLIProvider implements LLMProvider {
  private queue = new PQueue({ concurrency: 1 });

  async call(prompt: string, options?: LLMCallOptions): Promise<string> {
    return this.queue.add(async () => {
      // Prepend system prompt if provided (claude --print has no separate system prompt flag)
      const fullPrompt = options?.systemPrompt
        ? `${options.systemPrompt}\n\n---\n\n${prompt}`
        : prompt;

      return new Promise<string>((resolve, reject) => {
        const child = spawn('claude', ['--print'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let totalBytes = 0;

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BUFFER) {
            child.kill('SIGTERM');
            reject(new Error(`Claude CLI output exceeded ${MAX_BUFFER} bytes`));
            return;
          }
          stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim()}`));
            return;
          }
          resolve(stdout.trim());
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
        });

        // Write prompt to stdin and close
        child.stdin.write(fullPrompt);
        child.stdin.end();
      });
    }) as Promise<string>;
  }
}
