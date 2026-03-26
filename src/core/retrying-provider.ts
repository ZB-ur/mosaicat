import type { LLMProvider, LLMCallOptions, LLMResponse } from './llm-provider.js';
import { logRetry, classifyError } from './retry-log.js';
import { CircuitOpenError } from './stage-outcome.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;  // default 5
  recoveryMs: number;        // default 30_000
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 20,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
};

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryMs: 30_000,
};

/**
 * Decorator that wraps any LLMProvider with bounded retry + exponential backoff + circuit breaker.
 * Only retries transient errors (429, 5xx, network). Does NOT retry timeouts
 * (timeout means LLM was working but didn't finish -- retrying resends entire prompt).
 *
 * Circuit breaker opens after failureThreshold consecutive failures, then lazily
 * transitions to HALF_OPEN after recoveryMs to probe with a single request.
 */
export class RetryingProvider implements LLMProvider {
  private inner: LLMProvider;
  private config: RetryConfig;
  private onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  private runId = '';
  private stage = '' as import('./types.js').StageName;

  // Circuit breaker state
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private circuitConfig: CircuitBreakerConfig;

  constructor(
    inner: LLMProvider,
    config?: Partial<RetryConfig>,
    onRetry?: (attempt: number, delayMs: number, error: Error) => void,
    circuitConfig?: Partial<CircuitBreakerConfig>,
  ) {
    this.inner = inner;
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.onRetry = onRetry;
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...circuitConfig };
  }

  /** Set context for retry logging. Called by orchestrator before each stage. */
  setContext(runId: string, stage: import('./types.js').StageName): void {
    this.runId = runId;
    this.stage = stage;
  }

  /**
   * Check circuit breaker state. If OPEN and recovery time has elapsed,
   * transition to HALF_OPEN. If still OPEN, throw CircuitOpenError.
   */
  private checkCircuit(): void {
    if (this.circuitState === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.circuitConfig.recoveryMs) {
        this.circuitState = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError(this.circuitConfig.recoveryMs - elapsed);
      }
    }
  }

  /** Record a successful call. Resets consecutive failure counter and closes circuit if HALF_OPEN. */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
    }
  }

  /** Record a failed call. Opens circuit if threshold reached, or immediately if HALF_OPEN. */
  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.circuitState === 'HALF_OPEN' || this.consecutiveFailures >= this.circuitConfig.failureThreshold) {
      this.circuitState = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const { maxRetries, baseDelayMs, maxDelayMs } = this.config;

    for (let attempt = 1; ; attempt++) {
      try {
        this.checkCircuit();
        const result = await this.inner.call(prompt, options);
        this.recordSuccess();
        return result;
      } catch (err) {
        // Re-throw CircuitOpenError immediately (don't retry)
        if (err instanceof CircuitOpenError) {
          throw err;
        }

        if (!isRetryableError(err) || attempt > maxRetries) {
          throw err;
        }

        this.recordFailure();

        // If circuit just opened, stop retrying and throw CircuitOpenError
        if (this.circuitState === 'OPEN') {
          throw new CircuitOpenError(this.circuitConfig.recoveryMs);
        }

        const jitter = Math.random() * 500;
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);

        const error = err instanceof Error ? err : new Error(String(err));
        console.warn(`[retry] attempt ${attempt}, waiting ${Math.round(delay)}ms: ${error.message}`);

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
