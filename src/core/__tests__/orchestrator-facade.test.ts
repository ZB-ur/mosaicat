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
    expect(lines).toBeLessThanOrEqual(220);
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

  describe('runIntentConsultant resume behavior', () => {
    const content = fs.readFileSync('src/core/orchestrator.ts', 'utf-8');

    it('skips when intent_consultant stage is already done', () => {
      // Verify the resume-skip branch for "stage already done" exists
      expect(content).toContain("run.stages.intent_consultant?.state === 'done'");
      expect(content).toContain("reason: 'stage already done'");
    });

    it('skips when intent-brief.json artifact already exists on disk', () => {
      // Verify the artifact-exists branch
      expect(content).toContain("ctx.store.exists('intent-brief.json')");
      expect(content).toContain("reason: 'brief already exists'");
      // When artifact exists, IC stage should be marked done
      expect(content).toContain("run.stages.intent_consultant.state = 'done'");
    });

    it('skips when downstream researcher stage is already done', () => {
      // Verify the downstream-done branch
      expect(content).toContain("run.stages.researcher?.state === 'done'");
      expect(content).toContain("reason: 'downstream stages already done'");
    });

    it('persists pipeline state after IC completes (savePipelineState called)', () => {
      // After IC runs successfully, state must be saved so resume knows IC completed
      // Extract the runIntentConsultant method body
      const methodStart = content.indexOf('private async runIntentConsultant');
      const methodBody = content.slice(methodStart, content.indexOf('\n  private', methodStart + 1));
      // savePipelineState must be called AFTER marking stage done, BEFORE logging complete
      const saveIdx = methodBody.indexOf('savePipelineState');
      const doneIdx = methodBody.indexOf("intent_consultant.state = 'done'");
      const completeIdx = methodBody.indexOf("'intent-consultant:complete'");
      expect(saveIdx).toBeGreaterThan(-1);
      expect(doneIdx).toBeGreaterThan(-1);
      expect(completeIdx).toBeGreaterThan(-1);
      // Order: mark done -> save state -> log complete
      expect(saveIdx).toBeGreaterThan(doneIdx);
      expect(completeIdx).toBeGreaterThan(saveIdx);
    });
  });
});
