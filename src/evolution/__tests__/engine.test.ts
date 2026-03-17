import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import { Logger } from '../../core/logger.js';
import { EvolutionEngine } from '../engine.js';

const STATE_DIR = '.mosaic/evolution';
const STATE_FILE = '.mosaic/evolution/state.json';

class StubEvolutionProvider implements LLMProvider {
  response: string = '[]';

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: this.response };
  }
}

function setupArtifacts(runId: string) {
  fs.mkdirSync('.mosaic/artifacts', { recursive: true });
  fs.writeFileSync(
    '.mosaic/artifacts/validation-report.md',
    '## Validation Summary\n- Status: PASS\n- Checks passed: 4/4'
  );
  fs.writeFileSync(
    '.mosaic/artifacts/research.manifest.json',
    JSON.stringify({ competitors: ['A'], key_insights: ['test'] })
  );
  fs.mkdirSync(`.mosaic/logs/${runId}`, { recursive: true });
  fs.writeFileSync(
    `.mosaic/logs/${runId}/pipeline.log`,
    'stage:start researcher\nstage:complete researcher\n'
  );
}

describe('EvolutionEngine', () => {
  let provider: StubEvolutionProvider;
  let logger: Logger;
  const runId = 'run-test-evo';

  beforeEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
    provider = new StubEvolutionProvider();
    logger = new Logger(runId);
  });

  afterEach(async () => {
    await logger.close();
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('returns empty array when no artifacts exist', async () => {
    const engine = new EvolutionEngine(provider, logger);
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });

  it('calls LLM with pipeline summary and parses proposals', async () => {
    setupArtifacts(runId);

    provider.response = JSON.stringify([
      {
        type: 'prompt_modification',
        agentStage: 'researcher',
        reason: 'Improve competitor analysis depth',
        proposedContent: '# Improved Researcher Prompt\nBe more thorough.',
      },
    ]);

    const engine = new EvolutionEngine(provider, logger);
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].type).toBe('prompt_modification');
    expect(proposals[0].agentStage).toBe('researcher');
    expect(proposals[0].status).toBe('pending');
    expect(proposals[0].runId).toBe(runId);
  });

  it('parses proposals wrapped in markdown code blocks', async () => {
    setupArtifacts(runId);

    provider.response = '```json\n' + JSON.stringify([
      {
        type: 'skill_creation',
        agentStage: 'researcher',
        reason: 'Reusable pattern',
        proposedContent: '# Skill content',
        skillMetadata: { name: 'test-skill', scope: 'shared', description: 'Test' },
      },
    ]) + '\n```';

    const engine = new EvolutionEngine(provider, logger);
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].type).toBe('skill_creation');
  });

  it('returns empty array on invalid JSON response', async () => {
    setupArtifacts(runId);
    provider.response = 'This is not valid JSON at all.';

    const engine = new EvolutionEngine(provider, logger);
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });

  it('filters invalid candidates via Zod validation', async () => {
    setupArtifacts(runId);

    provider.response = JSON.stringify([
      { type: 'invalid_type', agentStage: 'researcher', reason: 'test', proposedContent: 'test' },
      { type: 'prompt_modification', agentStage: 'researcher', reason: 'valid', proposedContent: 'valid' },
    ]);

    const engine = new EvolutionEngine(provider, logger);
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].reason).toBe('valid');
  });

  describe('cooldown enforcement', () => {
    it('blocks prompt_modification within cooldown period', async () => {
      setupArtifacts(runId);

      // First analysis — should produce a proposal
      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'first', proposedContent: 'v1' },
      ]);

      const engine = new EvolutionEngine(provider, logger);
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Second analysis — should be blocked by cooldown
      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'second', proposedContent: 'v2' },
      ]);

      // Need to resolve the first proposal to remove pending block
      const state = engine.loadState();
      state.proposals[0].status = 'approved';
      engine.saveState(state);

      const second = await engine.analyze(runId);
      expect(second.length).toBe(0);
    });

    it('allows skill_creation without cooldown', async () => {
      setupArtifacts(runId);

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'first', proposedContent: 'skill1', skillMetadata: { name: 's1', scope: 'shared', description: 'd1' } },
      ]);

      const engine = new EvolutionEngine(provider, logger);
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Resolve first
      const state = engine.loadState();
      state.proposals[0].status = 'approved';
      engine.saveState(state);

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'second', proposedContent: 'skill2', skillMetadata: { name: 's2', scope: 'shared', description: 'd2' } },
      ]);

      const second = await engine.analyze(runId);
      expect(second.length).toBe(1);
    });
  });

  describe('max-1-pending-per-agent', () => {
    it('blocks second proposal for same agent when first is pending', async () => {
      setupArtifacts(runId);

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'first', proposedContent: 'skill1', skillMetadata: { name: 's1', scope: 'shared', description: 'd1' } },
      ]);

      const engine = new EvolutionEngine(provider, logger);
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Don't resolve — still pending
      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'second', proposedContent: 'skill2', skillMetadata: { name: 's2', scope: 'shared', description: 'd2' } },
      ]);

      const second = await engine.analyze(runId);
      expect(second.length).toBe(0);
    });
  });

  describe('state persistence', () => {
    it('saves and loads state correctly', () => {
      const engine = new EvolutionEngine(provider, logger);

      const state = engine.loadState();
      expect(state.proposals).toEqual([]);
      expect(state.promptVersions).toEqual({});
      expect(state.cooldowns).toEqual({});

      state.cooldowns['test'] = new Date().toISOString();
      engine.saveState(state);

      const reloaded = engine.loadState();
      expect(reloaded.cooldowns['test']).toBeDefined();
    });

    it('persists proposals across analyze calls', async () => {
      setupArtifacts(runId);

      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'test', proposedContent: 'new prompt' },
      ]);

      const engine = new EvolutionEngine(provider, logger);
      await engine.analyze(runId);

      const state = engine.loadState();
      expect(state.proposals.length).toBe(1);
      expect(state.proposals[0].status).toBe('pending');
    });
  });

  it('handles LLM call failure gracefully', async () => {
    setupArtifacts(runId);

    const failingProvider: LLMProvider = {
      async call(): Promise<LLMResponse> { throw new Error('LLM unavailable'); },
    };

    const engine = new EvolutionEngine(failingProvider, logger);
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });
});
