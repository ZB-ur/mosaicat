import type { StageName, ReviewComment } from './types.js';

/**
 * Discriminated union representing the outcome of a pipeline stage execution.
 * Each variant carries only the data relevant to that outcome type.
 */
export type StageOutcome =
  | { readonly type: 'done' }
  | { readonly type: 'skipped' }
  | { readonly type: 'retry'; readonly reason: string; readonly attempt: number }
  | { readonly type: 'rejected'; readonly feedback?: string; readonly comments?: ReviewComment[] }
  | { readonly type: 'failed'; readonly error: string; readonly retriesExhausted: boolean }
  | { readonly type: 'fix_loop'; readonly stage: StageName };

/**
 * Error thrown when the circuit breaker is in OPEN state.
 * Callers should not retry until remainingMs has elapsed.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`Circuit breaker is OPEN. Recovery in ${Math.ceil(remainingMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}
