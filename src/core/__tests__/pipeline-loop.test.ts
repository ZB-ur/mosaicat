import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineLoop } from '../pipeline-loop.js';
import type { PipelineLoopCallbacks } from '../pipeline-loop.js';
import type { StageExecutor } from '../stage-executor.js';
import type { FixLoopRunner } from '../fix-loop-runner.js';
import type { RunContext } from '../run-context.js';
import type { PipelineRun, StageName } from '../types.js';
import type { StageOutcome } from '../stage-outcome.js';
import { createPipelineRun } from '../pipeline.js';
import { createTestRunContext } from '../../__tests__/test-helpers.js';

function createMockExecutor(outcomes?: StageOutcome[]): StageExecutor {
  const fn = vi.fn();
  if (outcomes) {
    for (const outcome of outcomes) {
      fn.mockResolvedValueOnce(outcome);
    }
  } else {
    fn.mockResolvedValue({ type: 'done' });
  }
  return { execute: fn } as unknown as StageExecutor;
}

function createMockFixRunner(): FixLoopRunner {
  return {
    run: vi.fn().mockResolvedValue(undefined),
  } as unknown as FixLoopRunner;
}

function createCallbacks(overrides?: Partial<PipelineLoopCallbacks>): PipelineLoopCallbacks {
  return {
    savePipelineState: vi.fn(),
    ...overrides,
  };
}

const TEST_STAGES: readonly StageName[] = [
  'intent_consultant', 'researcher', 'product_owner',
];

describe('PipelineLoop', () => {
  let ctx: RunContext;
  let run: PipelineRun;

  beforeEach(() => {
    ctx = createTestRunContext();
    run = createPipelineRun('test-run', 'test instruction', false, TEST_STAGES);
  });

  it('iterates through stages sequentially using a while loop', async () => {
    const executor = createMockExecutor();
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[0][1]).toBe('intent_consultant');
    expect(calls[1][1]).toBe('researcher');
    expect(calls[2][1]).toBe('product_owner');
  });

  it('advances on done outcome', async () => {
    const executor = createMockExecutor([
      { type: 'done' },
      { type: 'done' },
      { type: 'done' },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('advances on skipped outcome', async () => {
    const executor = createMockExecutor([
      { type: 'skipped' },
      { type: 'done' },
      { type: 'done' },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('stays on same stage for retry outcome', async () => {
    const executor = createMockExecutor([
      { type: 'retry', reason: 'timeout', attempt: 1 },
      { type: 'done' },
      { type: 'done' },
      { type: 'done' },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    // First call: intent_consultant -> retry, second call: intent_consultant again -> done
    expect(calls.length).toBe(4);
    expect(calls[0][1]).toBe('intent_consultant');
    expect(calls[1][1]).toBe('intent_consultant');
  });

  it('stays on same stage for rejected outcome', async () => {
    const executor = createMockExecutor([
      { type: 'rejected', feedback: 'needs work' },
      { type: 'done' },
      { type: 'done' },
      { type: 'done' },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(4);
    expect(calls[0][1]).toBe('intent_consultant');
    expect(calls[1][1]).toBe('intent_consultant');
  });

  it('delegates to FixLoopRunner on fix_loop outcome, then advances past tester', async () => {
    const stages: readonly StageName[] = ['coder', 'tester', 'reviewer'];
    const testRun = createPipelineRun('test-run', 'test', false, stages);

    const executor = createMockExecutor([
      { type: 'done' },                         // coder
      { type: 'fix_loop', stage: 'tester' },     // tester -> fix loop
      { type: 'done' },                          // reviewer (after fix loop)
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(testRun, stages);

    expect((fixRunner.run as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    // After fix loop, should advance to reviewer
    const execCalls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(execCalls[2][1]).toBe('reviewer');
  });

  it('asks user on failed (retriesExhausted) when not autoApprove: skip', async () => {
    const executor = createMockExecutor([
      { type: 'failed', error: 'boom', retriesExhausted: true },
      { type: 'done' },
      { type: 'done' },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks({
      onStageExhausted: vi.fn().mockResolvedValue('skip'),
    });

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    expect(callbacks.onStageExhausted).toHaveBeenCalledOnce();
    // Should skip and continue to next stages
    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[1][1]).toBe('researcher');
  });

  it('aborts pipeline on failed when autoApprove is true', async () => {
    const autoRun = createPipelineRun('test-run', 'test', true, TEST_STAGES);

    const executor = createMockExecutor([
      { type: 'failed', error: 'boom', retriesExhausted: true },
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await expect(loop.run(autoRun, TEST_STAGES)).rejects.toThrow('Pipeline aborted');
  });

  it('checks ctx.signal.aborted before each stage, exits early if aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortedCtx = createTestRunContext({ signal: controller.signal });

    const executor = createMockExecutor();
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, abortedCtx, callbacks);
    await loop.run(run, TEST_STAGES);

    // Should not execute any stages
    expect((executor.execute as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('emits pipeline:start at beginning and pipeline:complete at end', async () => {
    const executor = createMockExecutor();
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const events: string[] = [];
    ctx.eventBus.on('pipeline:start', () => events.push('start'));
    ctx.eventBus.on('pipeline:complete', () => events.push('complete'));

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    expect(events[0]).toBe('start');
    expect(events[events.length - 1]).toBe('complete');
  });

  it('calls savePipelineState after each stage', async () => {
    const executor = createMockExecutor();
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    // 3 stages + 1 final save at pipeline:complete
    expect((callbacks.savePipelineState as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('event sequence: pipeline:start -> stages -> pipeline:complete', async () => {
    const executor = createMockExecutor();
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks();

    const events: string[] = [];
    ctx.eventBus.on('pipeline:start', () => events.push('pipeline:start'));
    ctx.eventBus.on('pipeline:complete', () => events.push('pipeline:complete'));

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    expect(events[0]).toBe('pipeline:start');
    expect(events[events.length - 1]).toBe('pipeline:complete');
    expect(events.length).toBe(2); // just start and complete from pipeline level
  });

  it('saves fixLoopRound in state when fix loop is active', async () => {
    const stages: readonly StageName[] = ['coder', 'tester'];
    const testRun = createPipelineRun('test-run', 'test', false, stages);

    const executor = createMockExecutor([
      { type: 'done' },                        // coder
      { type: 'fix_loop', stage: 'tester' },    // tester -> fix loop
    ]);

    const fixRunner = createMockFixRunner();
    // Mock fixRunner.run to call the onStateSave with a round number
    (fixRunner.run as ReturnType<typeof vi.fn>).mockImplementation(
      async (_run: PipelineRun, onSave: (round: number) => void) => {
        onSave(1);
        onSave(2);
      },
    );

    const callbacks = createCallbacks();

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(testRun, stages);

    // savePipelineState should be called with fixLoopRound
    const saveCalls = (callbacks.savePipelineState as ReturnType<typeof vi.fn>).mock.calls;
    const fixLoopSaves = saveCalls.filter((c: unknown[]) => c.length > 1 && c[1] !== undefined);
    expect(fixLoopSaves.length).toBeGreaterThanOrEqual(2);
    expect(fixLoopSaves[0][1]).toBe(1);
    expect(fixLoopSaves[1][1]).toBe(2);
  });

  it('handles failed with retriesExhausted and retry decision', async () => {
    const executor = createMockExecutor([
      { type: 'failed', error: 'boom', retriesExhausted: true },
      { type: 'done' }, // intent_consultant retry
      { type: 'done' }, // researcher
      { type: 'done' }, // product_owner
    ]);
    const fixRunner = createMockFixRunner();
    const callbacks = createCallbacks({
      onStageExhausted: vi.fn().mockResolvedValue('retry'),
    });

    const loop = new PipelineLoop(executor, fixRunner, ctx, callbacks);
    await loop.run(run, TEST_STAGES);

    // Should retry the stage and continue
    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(4);
    expect(calls[0][1]).toBe('intent_consultant');
    expect(calls[1][1]).toBe('intent_consultant'); // retry
  });
});
