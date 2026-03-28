import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FixLoopRunner } from '../fix-loop-runner.js';
import type { FixStrategy } from '../fix-loop-runner.js';
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
  let onStateSave: (fixLoopRound: number) => void;

  beforeEach(() => {
    executor = createMockExecutor();
    const store = createTestArtifactStore();
    ctx = createTestRunContext({ store });
    run = createTestRun();
    onStateSave = vi.fn<(fixLoopRound: number) => void>();
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

  describe('stagnation detection', () => {
    const ASSERTION_FAIL_OUTPUT = [
      ' FAIL src/foo.test.ts',
      '  AssertionError: expected 1 to equal 2',
      '  expect(result).toBe(2)',
      ' FAIL src/bar.test.ts',
      '  AssertionError: expected "hello" to equal "world"',
      '  expect(greeting).toEqual("world")',
    ].join('\n');

    it('terminates early when identical failures repeat for 2 consecutive rounds', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', ASSERTION_FAIL_OUTPUT);

      // Executor never changes the test output -- same failures every round
      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'done' });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      // Should terminate after 2 rounds (stagnation), not 5
      // 2 rounds * 2 calls (coder + tester) = 4 calls
      const calls = (executor.execute as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeLessThan(10); // Less than full 5 rounds
      expect(calls.length).toBe(4); // Exactly 2 rounds
    });

    it('writes stagnation-report.md to store on stagnation', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', ASSERTION_FAIL_OUTPUT);

      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'done' });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      // Stagnation report should exist
      const report = ctx.store.read('stagnation-report.md');
      expect(report).toContain('# Stagnation Report');
      expect(report).toContain('src/foo.test.ts');
      expect(report).toContain('src/bar.test.ts');
      expect(report).toContain('assertion');
    });

    it('stagnation report contains suggested fix direction', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', ASSERTION_FAIL_OUTPUT);

      (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'done' });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      const report = ctx.store.read('stagnation-report.md');
      expect(report).toContain('Suggested Fix Direction');
      expect(report).toContain('logic mismatch');
    });

    it('does not stagnate when failures change between rounds', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));

      let round = 0;
      (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async (_run: unknown, stage: string) => {
        if (stage === 'tester') {
          round++;
          // Different failures each round
          ctx.store.write('test-report.md', [
            ` FAIL src/test-${round}.test.ts`,
            `  Error: unique failure ${round}`,
          ].join('\n'));
          if (round >= 5) {
            ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'pass' }));
          }
        }
        return { type: 'done' };
      });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      // Should run all 5 rounds since failures change each time
      expect(round).toBe(5);
    });
  });

  describe('classification-driven strategy', () => {
    it('selectApproach returns FixStrategy with direction based on error classification', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      // Write assertion errors
      ctx.store.write('test-report.md', [
        ' FAIL src/logic.test.ts',
        '  expect(add(1, 2)).toBe(4)',
        '  Expected: 4',
        '  Received: 3',
      ].join('\n'));

      let capturedApproach = '';
      let callCount = 0;
      (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'pass' }));
        }
        return { type: 'done' };
      });

      ctx.eventBus.on('coder:fix-round', (_round, _total, _passed, approach, errorCategory) => {
        capturedApproach = approach;
      });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      expect(capturedApproach).toBe('direct-fix');
    });

    it('emits errorCategory in coder:fix-round event', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', [
        ' FAIL src/import.test.ts',
        '  Cannot find module "./missing-module"',
        '  ERR_MODULE_NOT_FOUND',
      ].join('\n'));

      let capturedCategory: string | undefined;
      let callCount = 0;
      (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'pass' }));
        }
        return { type: 'done' };
      });

      ctx.eventBus.on('coder:fix-round', (_round, _total, _passed, _approach, errorCategory) => {
        capturedCategory = errorCategory;
      });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      expect(capturedCategory).toBe('parse-import');
    });

    it('includes classification context in test-failures-for-coder.md', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', [
        ' FAIL src/logic.test.ts',
        '  expect(result).toBe(42)',
        '  Expected: 42',
        '  Received: 0',
      ].join('\n'));

      let callCount = 0;
      (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'pass' }));
        }
        return { type: 'done' };
      });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      const coderFile = ctx.store.read('test-failures-for-coder.md');
      expect(coderFile).toContain('Test Failure Analysis');
      expect(coderFile).toContain('Fix Focus:');
      expect(coderFile).toContain('Fix direction:');
    });

    it('maps parse-import to config-dependency direction', async () => {
      ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'fail' }));
      ctx.store.write('test-report.md', [
        ' FAIL src/broken-import.test.ts',
        '  Cannot find module "@/lib/api"',
        '  Module not found: Error: cannot resolve',
      ].join('\n'));

      let callCount = 0;
      (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          ctx.store.write('test-report.manifest.json', JSON.stringify({ verdict: 'pass' }));
        }
        return { type: 'done' };
      });

      const runner = new FixLoopRunner(executor, ctx);
      await runner.run(run, onStateSave);

      const coderFile = ctx.store.read('test-failures-for-coder.md');
      expect(coderFile).toContain('config-dependency');
      expect(coderFile).toContain('Fix Focus: Config/Dependencies');
    });
  });
});
