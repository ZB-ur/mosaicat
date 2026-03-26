import type { LLMProvider, LLMCallOptions, LLMResponse } from './llm-provider.js';
import { logRetry, classifyError } from './retry-log.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: Infinity,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
};

/**
 * Decorator that wraps any LLMProvider with infinite retry + exponential backoff.
 * Only retries transient errors (429, 5xx, network). Does NOT retry timeouts
 * (timeout means LLM was working but didn't finish — retrying resends entire prompt).
 */
export class RetryingProvider implements LLMProvider {
  private inner: LLMProvider;
  private config: RetryConfig;
  private onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  private runId = '';
  private stage = '' as import('./types.js').StageName;

  constructor(
    inner: LLMProvider,
    config?: Partial<RetryConfig>,
    onRetry?: (attempt: number, delayMs: number, error: Error) => void,
  ) {
    this.inner = inner;
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.onRetry = onRetry;
  }

  /** Set context for retry logging. Called by orchestrator before each stage. */
  setContext(runId: string, stage: import('./types.js').StageName): void {
    this.runId = runId;
    this.stage = stage;
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const { maxRetries, baseDelayMs, maxDelayMs } = this.config;

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.inner.call(prompt, options);
      } catch (err) {
        if (!isRetryableError(err) || attempt > maxRetries) {
          throw err;
        }

        const jitter = Math.random() * 500;
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);

        const error = err instanceof Error ? err : new Error(String(err));
        process.stderr.write(`[retry] attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}\n`);

        // Log retry to persistent retry-log
        logRetry({
          timestamp: new Date().toISOString(),
          runId: this.runId,
          stage: this.stage,
          source: 'llm-retry',
          attempt,
          errorCategory: classifyError(error.message),
          errorMessage: error.message,
          resolved: false, // will be true if next attempt succeeds, but we log each attempt
        });

        if (this.onRetry) {
          this.onRetry(attempt, delay, error);
        }

        await sleep(delay);
      }
    }
  }
}

/**
 * Only retry transient errors. Do NOT retry:
 * - Timeout (LLM was working but didn't finish)
 * - ENOENT (spawn/config errors)
 * - Auth errors (401, 403)
 */
export function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|429|overloaded|capacity|too many requests|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|503|502|529/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
