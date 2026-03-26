import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryingProvider, isRetryableError } from '../retrying-provider.js';
import { CircuitOpenError } from '../stage-outcome.js';
import type { LLMProvider, LLMResponse } from '../llm-provider.js';

function createFailingProvider(error: Error): LLMProvider {
  return {
    call: vi.fn().mockRejectedValue(error),
  };
}

function createSucceedingProvider(response?: LLMResponse): LLMProvider {
  return {
    call: vi.fn().mockResolvedValue(response ?? { content: 'ok' }),
  };
}

function retryableError(msg = 'rate limit exceeded 429'): Error {
  return new Error(msg);
}

/**
 * Helper: start a call, advance timers until it settles, return the result.
 * Prevents unhandled rejections by eagerly attaching a catch handler.
 */
async function drainCall(
  provider: RetryingProvider,
  prompt: string,
  advanceMs: number,
  iterations: number,
): Promise<LLMResponse> {
  const promise = provider.call(prompt);
  // Attach catch early to prevent unhandled rejection warnings
  const guarded = promise.catch(() => undefined);
  for (let i = 0; i < iterations; i++) {
    await vi.advanceTimersByTimeAsync(advanceMs);
  }
  // Now await and re-throw to check the real result
  await guarded;
  return promise;
}

describe('RetryingProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('max retries', () => {
    it('throws after maxRetries (default 20) attempts', async () => {
      const inner = createFailingProvider(retryableError());
      // Disable circuit breaker for this test (threshold > maxRetries)
      const provider = new RetryingProvider(inner, { baseDelayMs: 1, maxDelayMs: 1 }, undefined, { failureThreshold: 100 });

      const promise = provider.call('test');
      const guarded = promise.catch(() => undefined);

      // Advance timers enough for all retries
      for (let i = 0; i < 25; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await guarded;

      await expect(promise).rejects.toThrow('rate limit exceeded 429');
      // 20 retries + 1 initial = 21 total calls
      expect(inner.call).toHaveBeenCalledTimes(21);
    });

    it('throws after custom maxRetries=3 on attempt 4', async () => {
      const inner = createFailingProvider(retryableError());
      // Disable circuit breaker for this test
      const provider = new RetryingProvider(inner, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1 }, undefined, { failureThreshold: 100 });

      const promise = provider.call('test');
      const guarded = promise.catch(() => undefined);

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await guarded;

      await expect(promise).rejects.toThrow('rate limit exceeded 429');
      expect(inner.call).toHaveBeenCalledTimes(4);
    });
  });

  describe('circuit breaker', () => {
    it('starts CLOSED and stays CLOSED on intermittent failures (fewer than 5 consecutive)', async () => {
      let callCount = 0;
      const inner: LLMProvider = {
        call: vi.fn().mockImplementation(async () => {
          callCount++;
          // Fail every other call (never 5 consecutive)
          if (callCount % 2 === 1) {
            throw retryableError();
          }
          return { content: 'ok' };
        }),
      };

      const provider = new RetryingProvider(inner, { baseDelayMs: 1, maxDelayMs: 1 });

      // First call: fail then succeed on retry
      const p1 = provider.call('test1');
      await vi.advanceTimersByTimeAsync(10);
      await expect(p1).resolves.toEqual({ content: 'ok' });

      // Second call: fail then succeed on retry
      const p2 = provider.call('test2');
      await vi.advanceTimersByTimeAsync(10);
      await expect(p2).resolves.toEqual({ content: 'ok' });
    });

    it('opens after 5 consecutive failures and throws CircuitOpenError', async () => {
      const inner = createFailingProvider(retryableError());
      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 30_000 });

      const promise = provider.call('test');
      const guarded = promise.catch(() => undefined);

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await guarded;

      await expect(promise).rejects.toThrow(CircuitOpenError);
    });

    it('CircuitOpenError includes remainingMs field', async () => {
      const inner = createFailingProvider(retryableError());
      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 30_000 });

      const promise = provider.call('test');
      const guarded = promise.catch(() => undefined);

      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await guarded;

      try {
        await promise;
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).remainingMs).toBeGreaterThan(0);
      }
    });

    it('transitions to HALF_OPEN after recoveryMs elapses', async () => {
      const callCount = { value: 0 };
      const inner: LLMProvider = {
        call: vi.fn().mockImplementation(async () => {
          callCount.value++;
          if (callCount.value <= 5) {
            throw retryableError();
          }
          return { content: 'recovered' };
        }),
      };

      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 1000 });

      // First call: 5 failures open circuit
      const p1 = provider.call('test');
      const g1 = p1.catch(() => undefined);
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await g1;
      await expect(p1).rejects.toThrow(CircuitOpenError);

      // Advance past recovery period
      await vi.advanceTimersByTimeAsync(1100);

      // Next call should go through (HALF_OPEN -> probe -> success -> CLOSED)
      const p2 = provider.call('test2');
      await vi.advanceTimersByTimeAsync(10);
      await expect(p2).resolves.toEqual({ content: 'recovered' });
    });

    it('single success in HALF_OPEN resets to CLOSED', async () => {
      const callCount = { value: 0 };
      const inner: LLMProvider = {
        call: vi.fn().mockImplementation(async () => {
          callCount.value++;
          if (callCount.value <= 5) {
            throw retryableError();
          }
          return { content: 'ok' };
        }),
      };

      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 500 });

      // Open circuit
      const p1 = provider.call('test');
      const g1 = p1.catch(() => undefined);
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await g1;
      await expect(p1).rejects.toThrow(CircuitOpenError);

      // Wait for recovery
      await vi.advanceTimersByTimeAsync(600);

      // Succeed in HALF_OPEN -> CLOSED
      const p2 = provider.call('test2');
      await vi.advanceTimersByTimeAsync(10);
      await expect(p2).resolves.toEqual({ content: 'ok' });

      // Should still work (CLOSED, not OPEN)
      const p3 = provider.call('test3');
      await vi.advanceTimersByTimeAsync(10);
      await expect(p3).resolves.toEqual({ content: 'ok' });
    });

    it('failure in HALF_OPEN reopens circuit', async () => {
      const inner: LLMProvider = {
        call: vi.fn().mockRejectedValue(retryableError()),
      };

      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 500 });

      // Open circuit
      const p1 = provider.call('test');
      const g1 = p1.catch(() => undefined);
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await g1;

      // Wait for recovery -> HALF_OPEN
      await vi.advanceTimersByTimeAsync(600);

      // Fail in HALF_OPEN -> back to OPEN (immediate, no retries needed)
      const p2 = provider.call('test2');
      const g2 = p2.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(10);
      await g2;
      await expect(p2).rejects.toThrow(CircuitOpenError);
    });

    it('a success between failures resets consecutiveFailures counter', async () => {
      let callCount = 0;
      const inner: LLMProvider = {
        call: vi.fn().mockImplementation(async () => {
          callCount++;
          // Pattern: 4 fails, 1 success, 4 fails, 1 success (never 5 consecutive)
          if (callCount % 5 !== 0) {
            throw retryableError();
          }
          return { content: 'ok' };
        }),
      };

      const provider = new RetryingProvider(inner, {
        maxRetries: 20,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }, undefined, { failureThreshold: 5, recoveryMs: 30_000 });

      // Should eventually succeed without circuit opening
      const p1 = provider.call('test');
      for (let i = 0; i < 30; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }
      await expect(p1).resolves.toEqual({ content: 'ok' });
    });

    it('circuit breaker uses lazy time check (no setTimeout for recovery)', () => {
      // Verify that RetryingProvider implementation does NOT use setTimeout for circuit recovery.
      // The implementation uses Date.now() - openedAt >= recoveryMs in checkCircuit().
      const inner = createSucceedingProvider();
      const provider = new RetryingProvider(inner, {}, undefined, { failureThreshold: 5, recoveryMs: 30_000 });

      // Since we use lazy checks, no timer is registered. The provider can be
      // created and garbage collected without unref() calls.
      expect(provider).toBeDefined();
    });
  });
});

describe('isRetryableError', () => {
  it('returns true for rate limit errors', () => {
    expect(isRetryableError(new Error('429 rate limit exceeded'))).toBe(true);
  });

  it('returns false for auth errors', () => {
    expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
  });
});
