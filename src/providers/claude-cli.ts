import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import type { LLMProvider, LLMCallOptions, LLMResponse, LLMUsage } from '../core/llm-provider.js';

const TIMEOUT_MS = 600_000; // 10 minutes — complex stages (ui_designer) need time for large outputs
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export class ClaudeCLIProvider implements LLMProvider {
  private queue = new PQueue({ concurrency: 1 });

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    return this.queue.add(async () => {
      // Prepend system prompt if provided (claude --print has no separate system prompt flag)
      const fullPrompt = options?.systemPrompt
        ? `${options.systemPrompt}\n\n---\n\n${prompt}`
        : prompt;

      return new Promise<LLMResponse>((resolve, reject) => {
        const child = spawn('claude', ['--print', '--output-format', 'json'], {
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

          // Parse JSON output from claude --output-format json
          try {
            const json = JSON.parse(stdout.trim());
            const content = json.result ?? stdout.trim();
            const usage: LLMUsage | undefined = json.usage
              ? {
                  input_tokens: json.usage.input_tokens ?? 0,
                  output_tokens: json.usage.output_tokens ?? 0,
                  cache_creation_input_tokens: json.usage.cache_creation_input_tokens,
                  cache_read_input_tokens: json.usage.cache_read_input_tokens,
                  cost_usd: json.total_cost_usd ?? json.cost_usd,
                }
              : undefined;

            resolve({ content, usage });
          } catch {
            // Fallback: if JSON parsing fails, treat entire output as content
            resolve({ content: stdout.trim() });
          }
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
        });

        // Write prompt to stdin and close
        child.stdin.write(fullPrompt);
        child.stdin.end();
      });
    }) as Promise<LLMResponse>;
  }
}
