import { describe, it, expect } from 'vitest';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
  getNextStage,
} from '../pipeline.js';
import { STAGE_ORDER } from '../types.js';

describe('Pipeline', () => {
  it('should create a pipeline run with all stages idle', () => {
    const run = createPipelineRun('run-1', 'test instruction', false);
    expect(run.id).toBe('run-1');
    expect(run.instruction).toBe('test instruction');
    for (const stage of STAGE_ORDER) {
      expect(run.stages[stage]!.state).toBe('idle');
      expect(run.stages[stage]!.retryCount).toBe(0);
    }
  });

  it('should transition stage states correctly', () => {
    const run = createPipelineRun('run-1', 'test', false);
    transitionStage(run, 'researcher', 'running');
    expect(run.stages.researcher!.state).toBe('running');
    expect(run.stages.researcher!.startedAt).toBeDefined();

    transitionStage(run, 'researcher', 'done');
    expect(run.stages.researcher!.state).toBe('done');
    expect(run.stages.researcher!.completedAt).toBeDefined();
  });

  it('should reject invalid transitions', () => {
    const run = createPipelineRun('run-1', 'test', false);
    expect(() => transitionStage(run, 'researcher', 'done')).toThrow('Invalid state transition');
  });

  it('should auto-approve for auto gates', () => {
    const run = createPipelineRun('run-1', 'test', false);
    expect(shouldAutoApprove(run, { clarification: true, gate: 'auto', retry_max: 3 })).toBe(true);
    expect(shouldAutoApprove(run, { clarification: false, gate: 'manual', retry_max: 3 })).toBe(false);
  });

  it('should auto-approve everything when autoApprove flag is set', () => {
    const run = createPipelineRun('run-1', 'test', true);
    expect(shouldAutoApprove(run, { clarification: false, gate: 'manual', retry_max: 3 })).toBe(true);
  });

  it('should get correct previous/next stages', () => {
    expect(getPreviousStage('researcher')).toBeNull();
    expect(getPreviousStage('product_owner')).toBe('researcher');
    expect(getNextStage('validator')).toBeNull();
    expect(getNextStage('researcher')).toBe('product_owner');
  });
});
