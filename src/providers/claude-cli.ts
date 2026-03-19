import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';

const TIMEOUT_MS = 600_000; // 10 minutes — complex stages (ui_designer, coder) need time
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export class ClaudeCLIProvider implements LLMProvider {
  private queue = new PQueue({ concurrency: 1 });

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    return this.queue.add(async () => {
      const args = this.buildArgs(options);

      return new Promise<LLMResponse>((resolve, reject) => {
        const child = spawn('claude', args, {
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

          resolve(this.parseOutput(stdout, options));
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
        });

        // Write prompt to stdin and close
        child.stdin.write(prompt);
        child.stdin.end();
      });
    }) as Promise<LLMResponse>;
  }

  private buildArgs(options?: LLMCallOptions): string[] {
    const args = ['--print', '--output-format', 'json'];

    if (options?.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    if (options?.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', ...options.allowedTools);
    }

    if (options?.jsonSchema) {
      args.push('--json-schema', JSON.stringify(options.jsonSchema));
    }

    if (options?.mcpConfigPaths) {
      for (const configPath of options.mcpConfigPaths) {
        args.push('--mcp-config', configPath);
      }
    }

    if (options?.maxBudgetUsd != null) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd));
    }

    // Skip permission prompts in pipeline mode
    args.push('--permission-mode', 'bypassPermissions');

    return args;
  }

  private parseOutput(stdout: string, options?: LLMCallOptions): LLMResponse {
    try {
      const json = JSON.parse(stdout.trim());

      // When --json-schema is used, structured output is in json.structured_output
      if (options?.jsonSchema && json.structured_output != null) {
        return { content: JSON.stringify(json.structured_output) };
      }

      const rawContent = json.result ?? stdout.trim();

      // If jsonSchema was requested but no structured_output, try result field
      if (options?.jsonSchema) {
        return { content: this.extractJsonContent(rawContent) };
      }

      return { content: rawContent };
    } catch {
      // Fallback: if JSON parsing fails, treat entire output as content
      return { content: stdout.trim() };
    }
  }

  /**
   * Extract JSON content from LLM output that may be wrapped in markdown code fences.
   */
  private extractJsonContent(raw: string): string {
    const trimmed = raw.trim();
    // Strip markdown code fences if present
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
    return trimmed;
  }
}
