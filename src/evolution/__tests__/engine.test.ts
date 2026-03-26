import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import { Logger } from '../../core/logger.js';
import { EvolutionEngine } from '../engine.js';
import { createTestMosaicDir, cleanupTestMosaicDir } from '../../__tests__/test-helpers.js';
import { initArtifactsDir, getArtifactsDir } from '../../core/artifact.js';

const STATE_DIR = '.mosaic/evolution';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

class StubEvolutionProvider implements LLMProvider {
  response: string = '[]';

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: this.response };
  }
}

function setupArtifacts(runId: string, tmpRoot: string) {
  const artifactsDir = getArtifactsDir();
  fs.writeFileSync(
    path.join(artifactsDir, 'validation-report.md'),
    '## Validation Summary\n- Status: PASS\n- Checks passed: 4/4'
  );
  fs.writeFileSync(
    path.join(artifactsDir, 'research.manifest.json'),
    JSON.stringify({ competitors: ['A'], key_insights: ['test'] })
  );
  const logsDir = path.join(tmpRoot, 'logs', runId);
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, 'pipeline.log'),
    'stage:start researcher\nstage:complete researcher\n'
  );
}

describe('EvolutionEngine', () => {
  let provider: StubEvolutionProvider;
  let logger: Logger;
  let tmpRoot: string;
  const runId = 'run-test-evo';

  beforeEach(() => {
    tmpRoot = createTestMosaicDir();
    initArtifactsDir(runId);
    provider = new StubEvolutionProvider();
    logger = new Logger(runId, path.join(tmpRoot, 'logs'));
  });

  afterEach(async () => {
    await logger.close();
    cleanupTestMosaicDir(tmpRoot);
  });

  it('returns empty array when no artifacts exist', async () => {
    const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });

  it('calls LLM with pipeline summary and parses proposals', async () => {
    setupArtifacts(runId, tmpRoot);

    provider.response = JSON.stringify([
      {
        type: 'prompt_modification',
        agentStage: 'researcher',
        reason: 'Improve competitor analysis depth',
        proposedContent: '# Improved Researcher Prompt\nBe more thorough.',
      },
    ]);

    const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].type).toBe('prompt_modification');
    expect(proposals[0].agentStage).toBe('researcher');
    expect(proposals[0].status).toBe('pending');
    expect(proposals[0].runId).toBe(runId);
  });

  it('parses proposals wrapped in markdown code blocks', async () => {
    setupArtifacts(runId, tmpRoot);

    provider.response = '```json\n' + JSON.stringify([
      {
        type: 'skill_creation',
        agentStage: 'researcher',
        reason: 'Reusable pattern',
        proposedContent: '# Skill content',
        skillMetadata: { name: 'test-skill', scope: 'shared', description: 'Test' },
      },
    ]) + '\n```';

    const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].type).toBe('skill_creation');
  });

  it('returns empty array on invalid JSON response', async () => {
    setupArtifacts(runId, tmpRoot);
    provider.response = 'This is not valid JSON at all.';

    const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });

  it('filters invalid candidates via Zod validation', async () => {
    setupArtifacts(runId, tmpRoot);

    provider.response = JSON.stringify([
      { type: 'invalid_type', agentStage: 'researcher', reason: 'test', proposedContent: 'test' },
      { type: 'prompt_modification', agentStage: 'researcher', reason: 'valid', proposedContent: 'valid' },
    ]);

    const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
    const proposals = await engine.analyze(runId);

    expect(proposals.length).toBe(1);
    expect(proposals[0].reason).toBe('valid');
  });

  describe('cooldown enforcement', () => {
    it('blocks prompt_modification within cooldown period', async () => {
      setupArtifacts(runId, tmpRoot);

      // First analysis -- should produce a proposal
      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'first', proposedContent: 'v1' },
      ]);

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Second analysis -- should be blocked by cooldown
      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'second', proposedContent: 'v2' },
      ]);

      // Need to resolve the first proposal to remove pending block
      const stateResult = engine.loadState();
      expect(stateResult.ok).toBe(true);
      if (stateResult.ok) {
        stateResult.value.proposals[0].status = 'approved';
        engine.saveState(stateResult.value);
      }

      const second = await engine.analyze(runId);
      expect(second.length).toBe(0);
    });

    it('allows skill_creation without cooldown', async () => {
      setupArtifacts(runId, tmpRoot);

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'first', proposedContent: 'skill1', skillMetadata: { name: 's1', scope: 'shared', description: 'd1' } },
      ]);

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Resolve first
      const stateResult = engine.loadState();
      expect(stateResult.ok).toBe(true);
      if (stateResult.ok) {
        stateResult.value.proposals[0].status = 'approved';
        engine.saveState(stateResult.value);
      }

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'second', proposedContent: 'skill2', skillMetadata: { name: 's2', scope: 'shared', description: 'd2' } },
      ]);

      const second = await engine.analyze(runId);
      expect(second.length).toBe(1);
    });
  });

  describe('max-1-pending-per-agent', () => {
    it('blocks second proposal for same agent when first is pending', async () => {
      setupArtifacts(runId, tmpRoot);

      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'first', proposedContent: 'skill1', skillMetadata: { name: 's1', scope: 'shared', description: 'd1' } },
      ]);

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const first = await engine.analyze(runId);
      expect(first.length).toBe(1);

      // Don't resolve -- still pending
      provider.response = JSON.stringify([
        { type: 'skill_creation', agentStage: 'researcher', reason: 'second', proposedContent: 'skill2', skillMetadata: { name: 's2', scope: 'shared', description: 'd2' } },
      ]);

      const second = await engine.analyze(runId);
      expect(second.length).toBe(0);
    });
  });

  describe('state persistence', () => {
    it('saves and loads state correctly', () => {
      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());

      const stateResult = engine.loadState();
      // No state file yet -- should return err
      expect(stateResult.ok).toBe(false);

      // Save a state and reload
      const state = { proposals: [], promptVersions: {}, cooldowns: { test: new Date().toISOString() } };
      engine.saveState(state);

      const reloaded = engine.loadState();
      expect(reloaded.ok).toBe(true);
      if (reloaded.ok) {
        expect(reloaded.value.cooldowns['test']).toBeDefined();
      }
    });

    it('persists proposals across analyze calls', async () => {
      setupArtifacts(runId, tmpRoot);

      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'test', proposedContent: 'new prompt' },
      ]);

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      await engine.analyze(runId);

      const stateResult = engine.loadState();
      expect(stateResult.ok).toBe(true);
      if (stateResult.ok) {
        expect(stateResult.value.proposals.length).toBe(1);
        expect(stateResult.value.proposals[0].status).toBe('pending');
      }
    });
  });

  it('handles LLM call failure gracefully', async () => {
    setupArtifacts(runId, tmpRoot);

    const failingProvider: LLMProvider = {
      async call(): Promise<LLMResponse> { throw new Error('LLM unavailable'); },
    };

    const engine = new EvolutionEngine(failingProvider, logger);
    const proposals = await engine.analyze(runId);
    expect(proposals).toEqual([]);
  });

  describe('error handling', () => {
    it('loadState returns Result.err for corrupt JSON', () => {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, '{corrupt json!!!');

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const result = engine.loadState();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('state-file-unreadable');
      }
    });

    it('loadState returns Result.err when state file is missing', () => {
      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const result = engine.loadState();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('state-file-unreadable');
      }
    });

    it('buildStageSummary logs warning for missing artifact files', async () => {
      // Create artifacts dir but no files for the stage
      fs.mkdirSync('.mosaic/artifacts', { recursive: true });

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const logSpy = vi.spyOn(logger, 'pipeline');

      const proposals = await engine.analyzeStage(runId, 'researcher');
      expect(proposals).toEqual([]);

      // Should have logged warnings for missing files
      const warnCalls = logSpy.mock.calls.filter(
        (c) => c[0] === 'warn' && (c[1] as string).includes('stage-summary-read-failed')
      );
      expect(warnCalls.length).toBeGreaterThan(0);
    });

    it('parseCandidates returns Result.err for invalid JSON', async () => {
      setupArtifacts(runId, tmpRoot);
      provider.response = 'not json {{{';

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const logSpy = vi.spyOn(logger, 'pipeline');

      const proposals = await engine.analyze(runId);
      expect(proposals).toEqual([]);

      // Should have logged parse error
      const parseCalls = logSpy.mock.calls.filter(
        (c) => c[0] === 'warn' && (c[1] as string).includes('parse-error')
      );
      expect(parseCalls.length).toBeGreaterThan(0);
    });

    it('analyze still works when state file is corrupt (uses fallback)', async () => {
      setupArtifacts(runId, tmpRoot);
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, 'CORRUPT');

      provider.response = JSON.stringify([
        { type: 'prompt_modification', agentStage: 'researcher', reason: 'test', proposedContent: 'content' },
      ]);

      const engine = new EvolutionEngine(provider, logger, getArtifactsDir());
      const proposals = await engine.analyze(runId);

      // Should still produce proposals using fallback empty state
      expect(proposals.length).toBe(1);
    });
  });
});
