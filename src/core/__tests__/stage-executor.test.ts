import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineRun, AgentsConfig, AgentContext, StageName, StageConfig } from '../types.js';
import { ClarificationNeeded } from '../types.js';
import type { StageOutcome } from '../stage-outcome.js';
import type { InteractionHandler } from '../interaction-handler.js';
import type { RunContext } from '../run-context.js';
import { createPipelineRun } from '../pipeline.js';
import { StageExecutor } from '../stage-executor.js';
import {
  createTestRunContext,
  createTestPipelineConfig,
  createMockLogger,
  createMockProvider,
} from '../../__tests__/test-helpers.js';

// --- Mock dependencies ---
vi.mock('../context-manager.js', () => ({
  buildContext: vi.fn().mockReturnValue({
    systemPrompt: 'test prompt',
    task: { runId: 'run-1', stage: 'researcher', instruction: 'test' },
    inputArtifacts: new Map(),
  } satisfies AgentContext),
}));

vi.mock('../agent-factory.js', () => ({
  createAgent: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../snapshot.js', () => ({
  createSnapshot: vi.fn(),
}));

vi.mock('../retry-log.js', () => ({
  logRetry: vi.fn(),
  classifyError: vi.fn().mockReturnValue('unknown'),
}));

import { buildContext } from '../context-manager.js';
import { createAgent } from '../agent-factory.js';
import { createSnapshot } from '../snapshot.js';
import { logRetry } from '../retry-log.js';

// --- Test fixtures ---
const TEST_STAGES: readonly StageName[] = ['researcher', 'product_owner', 'tester'];

function createTestAgentsConfig(): AgentsConfig {
  return {
    agents: {
      researcher: {
        name: 'Researcher',
        prompt_file: 'prompts/researcher.md',
        inputs: ['intent-brief.json'],
        outputs: ['research.md'],
      },
      tester: {
        name: 'Tester',
        prompt_file: 'prompts/tester.md',
        inputs: ['test-plan.md'],
        outputs: ['test-report.md'],
      },
    },
  };
}

function createMockHandler(): InteractionHandler {
  return {
    onManualGate: vi.fn().mockResolvedValue({ approved: true }),
    onClarification: vi.fn().mockResolvedValue('user answer'),
  };
}

describe('StageExecutor', () => {
  let ctx: RunContext;
  let agentsConfig: AgentsConfig;
  let handler: InteractionHandler;
  let executor: StageExecutor;
  let run: PipelineRun;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set default mock implementations after clearAllMocks
    (buildContext as ReturnType<typeof vi.fn>).mockReturnValue({
      systemPrompt: 'test prompt',
      task: { runId: 'run-1', stage: 'researcher', instruction: 'test' },
      inputArtifacts: new Map(),
    });
    (createAgent as ReturnType<typeof vi.fn>).mockReturnValue({
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const stageConfig: StageConfig = { clarification: true, gate: 'auto', retry_max: 3 };
    ctx = createTestRunContext({
      config: createTestPipelineConfig({
        stages: {
          researcher: stageConfig,
          product_owner: { ...stageConfig, gate: 'manual' },
          tester: stageConfig,
        },
      }),
    });
    agentsConfig = createTestAgentsConfig();
    handler = createMockHandler();
    executor = new StageExecutor(ctx, agentsConfig, handler);
    run = createPipelineRun('run-1', 'test instruction', false, TEST_STAGES);
  });

  it('returns { type: "skipped" } when stage state is "done"', async () => {
    // Pre-set stage to done
    run.stages.researcher!.state = 'done';

    const result = await executor.execute(run, 'researcher');

    expect(result).toEqual({ type: 'skipped' });
  });

  it('returns { type: "done" } for auto-approved stage after successful agent run', async () => {
    const result = await executor.execute(run, 'researcher');

    expect(result).toEqual({ type: 'done' });
    expect(run.stages.researcher!.state).toBe('done');
  });

  it('returns { type: "rejected" } when manual gate rejects', async () => {
    const feedback = 'Needs more detail';
    const comments = [{ path: 'research.md', line: 1, body: 'Too vague' }];
    (handler.onManualGate as ReturnType<typeof vi.fn>).mockResolvedValue({
      approved: false,
      feedback,
      comments,
    });

    const result = await executor.execute(run, 'product_owner');

    expect(result).toEqual({
      type: 'rejected',
      feedback,
      comments,
    });
    // After rejection, stage should be reset to idle for retry
    expect(run.stages.product_owner!.state).toBe('idle');
    expect(run.stages.product_owner!.retryCount).toBe(1);
  });

  it('returns { type: "retry" } on retryable agent error within retry_max', async () => {
    const mockAgent = { execute: vi.fn().mockRejectedValue(new Error('LLM timeout')) };
    (createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

    const result = await executor.execute(run, 'researcher');

    expect(result.type).toBe('retry');
    if (result.type === 'retry') {
      expect(result.reason).toBe('LLM timeout');
      expect(result.attempt).toBe(1);
    }
    expect(logRetry).toHaveBeenCalled();
  });

  it('returns { type: "failed", retriesExhausted: true } when retryCount >= retry_max', async () => {
    const mockAgent = { execute: vi.fn().mockRejectedValue(new Error('Persistent failure')) };
    (createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

    // Set retryCount to max already
    run.stages.researcher!.retryCount = 3;

    const result = await executor.execute(run, 'researcher');

    expect(result).toEqual({
      type: 'failed',
      error: 'Persistent failure',
      retriesExhausted: true,
    });
  });

  it('returns { type: "fix_loop", stage: "tester" } when tester stage detects test failures', async () => {
    // Mock store to return a failing test manifest
    const storeSpy = vi.spyOn(ctx.store, 'read').mockReturnValue(
      JSON.stringify({ verdict: 'fail', failed: 3, total: 10 }),
    );

    const result = await executor.execute(run, 'tester');

    expect(result).toEqual({ type: 'fix_loop', stage: 'tester' });
    storeSpy.mockRestore();
  });

  it('handles ClarificationNeeded by calling handler.onClarification then re-running agent', async () => {
    const clarificationError = new ClarificationNeeded(
      'What scope?',
      [{ label: 'narrow' }, { label: 'broad' }],
      true,
      'Research scope selection',
      'Affects depth of analysis',
    );

    // First call throws ClarificationNeeded, second succeeds
    const mockAgent = {
      execute: vi.fn()
        .mockRejectedValueOnce(clarificationError)
        .mockResolvedValueOnce(undefined),
    };
    (createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

    const result = await executor.execute(run, 'researcher');

    expect(result).toEqual({ type: 'done' });
    expect(handler.onClarification).toHaveBeenCalledWith(
      'researcher',
      'What scope?',
      'run-1',
      [{ label: 'narrow' }, { label: 'broad' }],
      true,
      'Research scope selection',
      'Affects depth of analysis',
    );
    expect(mockAgent.execute).toHaveBeenCalledTimes(2);
  });

  it('calls provider.setContext?.() before agent execution (duck typing)', async () => {
    const setContext = vi.fn();
    const provider = { ...createMockProvider(), setContext };
    const ctxWithSetContext = createTestRunContext({ provider });
    const exec = new StageExecutor(ctxWithSetContext, agentsConfig, handler);
    const r = createPipelineRun('run-2', 'test', false, TEST_STAGES);

    await exec.execute(r, 'researcher');

    expect(setContext).toHaveBeenCalledWith('run-2', 'researcher');
  });

  it('emits stage:start and stage:complete events on EventBus', async () => {
    const startSpy = vi.fn();
    const completeSpy = vi.fn();
    ctx.eventBus.on('stage:start', startSpy);
    ctx.eventBus.on('stage:complete', completeSpy);

    await executor.execute(run, 'researcher');

    expect(startSpy).toHaveBeenCalledWith('researcher', 'run-1');
    expect(completeSpy).toHaveBeenCalledWith('researcher', 'run-1');
  });

  it('creates snapshot after successful stage (non-blocking, error swallowed)', async () => {
    // Snapshot throws but execution succeeds
    (createSnapshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Snapshot write failed');
    });

    const result = await executor.execute(run, 'researcher');

    expect(result).toEqual({ type: 'done' });
    expect(createSnapshot).toHaveBeenCalled();
    // Verify warning was logged
    expect(ctx.logger.pipeline).toHaveBeenCalledWith(
      'warn', 'snapshot:failed',
      expect.objectContaining({ stage: 'researcher' }),
    );
  });

  it('transitions stage states correctly: idle -> running -> done', async () => {
    expect(run.stages.researcher!.state).toBe('idle');

    await executor.execute(run, 'researcher');

    expect(run.stages.researcher!.state).toBe('done');
  });

  it('does NOT recurse — no recursive execute calls', () => {
    // Structural test: verify no recursion in the source
    // This is enforced by the grep check in verification, but we can also test
    // that the executor returns outcomes instead of retrying internally
    const mockAgent = { execute: vi.fn().mockRejectedValue(new Error('fail')) };
    (createAgent as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);

    // Should return 'retry' outcome, not call execute again
    return executor.execute(run, 'researcher').then(result => {
      expect(result.type).toBe('retry');
      // Agent was called only once — no internal retry
      expect(mockAgent.execute).toHaveBeenCalledTimes(1);
    });
  });
});
