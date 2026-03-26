import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Orchestrator } from '../orchestrator.js';
import type { GateResult } from '../types.js';
import type { InteractionHandler } from '../interaction-handler.js';

class AutoHandler implements InteractionHandler {
  async onManualGate(): Promise<GateResult> { return { approved: true }; }
  async onClarification(): Promise<string> { return 'test'; }
  async onEvolutionProposal() { return { approved: true }; }
}

describe('Orchestrator Facade', () => {
  it('is under 200 lines', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    const lines = content.split('\n').length;
    expect(lines).toBeLessThanOrEqual(200);
  });

  it('delegates to PipelineLoop, StageExecutor, and FixLoopRunner', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    expect(content).toContain('PipelineLoop');
    expect(content).toContain('StageExecutor');
    expect(content).toContain('FixLoopRunner');
  });

  it('does NOT contain executeStage or executeAgent methods', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    expect(content).not.toContain('executeStage');
    expect(content).not.toContain('executeAgent');
    expect(content).not.toContain('checkTesterVerdict');
    expect(content).not.toContain('injectTestFailuresForCoder');
  });

  it('both run() and resumeRun() call executePipeline()', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    // executePipeline should appear in run(), resumeRun(), and its own definition
    const matches = content.match(/executePipeline/g);
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves public API: constructor, run, resumeRun, getStageIssues, eventBus', () => {
    const orchestrator = new Orchestrator(new AutoHandler());
    expect(typeof orchestrator.run).toBe('function');
    expect(typeof orchestrator.resumeRun).toBe('function');
    expect(typeof orchestrator.getStageIssues).toBe('function');
    expect(orchestrator.eventBus).toBeDefined();
  });

  it('getStageIssues returns empty map when no adapter configured', () => {
    const orchestrator = new Orchestrator(new AutoHandler());
    const issues = orchestrator.getStageIssues();
    expect(issues).toBeInstanceOf(Map);
    expect(issues.size).toBe(0);
  });

  it('uses onStageComplete callback in executePipeline', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    expect(content).toContain('onStageComplete');
    expect(content).toContain('onStageExhausted');
    expect(content).toContain('savePipelineState');
  });

  it('delegates git operations to OrchestratorGitOps', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');
    expect(content).toContain('OrchestratorGitOps');
    expect(content).toContain('gitOps');
    // Git helper methods should NOT be in orchestrator
    expect(content).not.toContain('commitStageArtifacts');
    expect(content).not.toContain('postPreviewComment');
    expect(content).not.toContain('createStageIssue');
  });
});
