import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FixLoopRunner } from '../fix-loop-runner.js';
import type { StageExecutor } from '../stage-executor.js';
import type { RunContext } from '../run-context.js';
import type { PipelineRun } from '../types.js';
import { createPipelineRun } from '../pipeline.js';
import { createTestRunContext, createTestArtifactStore } from '../../__tests__/test-helpers.js';

function createMockExecutor(): StageExecutor {
  return {
    execute: vi.fn().mockResolvedValue({ type: 'done' }),
  } as unknown as StageExecutor;
}

function createTestRun(): PipelineRun {
  return createPipelineRun('test-run', 'test instruction', false, [
    'intent_consultant', 'researcher', 'product_owner',
    'ux_designer', 'api_designer', 'ui_designer',
    'tech_lead', 'coder', 'qa_lead', 'tester',
    'security_auditor', 'reviewer', 'validator',
  ]);
}

describe('FixLoopRunner', () => {
  let executor: StageExecutor;
  let ctx: RunContext;
  let run: PipelineRun;
  let onStateSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = createMockExecutor();
    const store = createTestArtifactStore();
    ctx = createTestRunContext({ store });
    run = createTestRun();
    onStateSave = vi.fn();
  });

  it('stops when tester verdict is pass (returns after 0 fix rounds)', async () => {
    // Write a passing manifest
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'pass',
    }));

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    // Executor should not be called -- tests already pass
    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(onStateSave).not.toHaveBeenCalled();
  });

  it('stops when no manifest exists (no failure = do not loop)', async () => {
    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('uses direct-fix approach for rounds 1 and 2', async () => {
    let callCount = 0;
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    // After 2 rounds, make it pass
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      // After round 2 tester call (call 4), make tests pass
      if (callCount >= 4) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const events: Array<{ round: number; approach: string }> = [];
    ctx.eventBus.on('coder:fix-round', (round, _total, _passed, approach) => {
      events.push({ round, approach });
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect(events[0]).toEqual({ round: 1, approach: 'direct-fix' });
    expect(events[1]).toEqual({ round: 2, approach: 'direct-fix' });
  });

  it('uses replan-failed-modules approach for round 3', async () => {
    let callCount = 0;
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      // After round 3 tester call (call 6), make tests pass
      if (callCount >= 6) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const events: Array<{ round: number; approach: string }> = [];
    ctx.eventBus.on('coder:fix-round', (round, _total, _passed, approach) => {
      events.push({ round, approach });
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect(events[2]).toEqual({ round: 3, approach: 'replan-failed-modules' });
  });

  it('uses full-history-fix approach for rounds 4 and 5', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    // Never pass -- run all 5 rounds
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'done' });

    const events: Array<{ round: number; approach: string }> = [];
    ctx.eventBus.on('coder:fix-round', (round, _total, _passed, approach) => {
      events.push({ round, approach });
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect(events[3]).toEqual({ round: 4, approach: 'full-history-fix' });
    expect(events[4]).toEqual({ round: 5, approach: 'full-history-fix' });
  });

  it('stops after maxRounds (5) even if tests still fail', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'done' });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    // 5 rounds * 2 calls (coder + tester) = 10 calls
    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(10);
  });

  it('resets coder and tester stage states to idle between rounds', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let checkCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      checkCount++;
      // After first round, check that stages were reset
      if (checkCount === 3) {
        // 3rd call = round 2 coder -- stages should have been reset
        expect(run.stages['coder']?.state).toBe('idle');
        expect(run.stages['tester']?.state).toBe('idle');
        // Make it pass to stop
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);
  });

  it('calls executor.execute for coder then tester each round', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let callCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toBe('coder');
    expect(calls[1][1]).toBe('tester');
  });

  it('emits coder:fix-round event with round number and approach', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let callCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const emitted: Array<[number, number, number, string]> = [];
    ctx.eventBus.on('coder:fix-round', (round, total, passed, approach) => {
      emitted.push([round, total, passed, approach]);
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0][0]).toBe(1); // round
    expect(emitted[0][3]).toBe('direct-fix'); // approach
  });

  it('calls onStateSave callback after each round for crash recovery', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let callCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount >= 4) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    expect(onStateSave).toHaveBeenCalledWith(1);
    expect(onStateSave).toHaveBeenCalledWith(2);
  });

  it('can resume from startRound (e.g., startRound=2 starts at round 3)', async () => {
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let callCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const events: Array<{ round: number; approach: string }> = [];
    ctx.eventBus.on('coder:fix-round', (round, _total, _passed, approach) => {
      events.push({ round, approach });
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave, 2); // start from round 2

    // First round should be 3 (startRound=2 means 2 already done)
    expect(events[0]).toEqual({ round: 3, approach: 'replan-failed-modules' });
  });

  it('reads test-report.manifest.json to check verdict', async () => {
    // Write fail verdict
    ctx.store.write('test-report.manifest.json', JSON.stringify({
      verdict: 'fail',
    }));

    let callCount = 0;
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      // On tester execution, update manifest to pass
      if (callCount === 2) {
        ctx.store.write('test-report.manifest.json', JSON.stringify({
          verdict: 'pass',
        }));
      }
      return { type: 'done' };
    });

    const runner = new FixLoopRunner(executor, ctx);
    await runner.run(run, onStateSave);

    // Should have done exactly 1 round (coder + tester)
    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
