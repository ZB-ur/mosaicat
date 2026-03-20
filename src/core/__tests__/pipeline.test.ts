import { describe, it, expect } from 'vitest';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
  getNextStage,
} from '../pipeline.js';
import { DEFAULT_STAGES } from '../types.js';

describe('Pipeline', () => {
  it('should create a pipeline run with all stages idle', () => {
    const run = createPipelineRun('run-1', 'test instruction', false, DEFAULT_STAGES);
    expect(run.id).toBe('run-1');
    expect(run.instruction).toBe('test instruction');
    for (const stage of DEFAULT_STAGES) {
      expect(run.stages[stage]!.state).toBe('idle');
      expect(run.stages[stage]!.retryCount).toBe(0);
    }
  });

  it('should transition stage states correctly', () => {
    const run = createPipelineRun('run-1', 'test', false, DEFAULT_STAGES);
    transitionStage(run, 'researcher', 'running');
    expect(run.stages.researcher!.state).toBe('running');
    expect(run.stages.researcher!.startedAt).toBeDefined();

    transitionStage(run, 'researcher', 'done');
    expect(run.stages.researcher!.state).toBe('done');
    expect(run.stages.researcher!.completedAt).toBeDefined();
  });

  it('should reject invalid transitions', () => {
    const run = createPipelineRun('run-1', 'test', false, DEFAULT_STAGES);
    expect(() => transitionStage(run, 'researcher', 'done')).toThrow('Invalid state transition');
  });

  it('should auto-approve for auto gates', () => {
    const run = createPipelineRun('run-1', 'test', false, DEFAULT_STAGES);
    expect(shouldAutoApprove(run, { clarification: true, gate: 'auto', retry_max: 3 })).toBe(true);
    expect(shouldAutoApprove(run, { clarification: false, gate: 'manual', retry_max: 3 })).toBe(false);
  });

  it('should auto-approve everything when autoApprove flag is set', () => {
    const run = createPipelineRun('run-1', 'test', true, DEFAULT_STAGES);
    expect(shouldAutoApprove(run, { clarification: false, gate: 'manual', retry_max: 3 })).toBe(true);
  });

  it('should get correct previous/next stages', () => {
    const run = createPipelineRun('run-1', 'test', false, DEFAULT_STAGES);
    expect(getPreviousStage(run, 'intent_consultant')).toBeNull();
    expect(getPreviousStage(run, 'researcher')).toBe('intent_consultant');
    expect(getNextStage(run, 'validator')).toBeNull();
    expect(getNextStage(run, 'researcher')).toBe('product_owner');
  });
});
