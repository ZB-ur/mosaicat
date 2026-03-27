/**
 * Resume Integration Tests
 *
 * Covers 5 scenarios from D-04:
 * 1. Basic resume: running states reset to idle, done states preserved
 * 2. --from reset + artifact cleanup: target + downstream reset, upstream untouched
 * 3. No unexpected file deletion: unrelated files survive resetFromStage
 * 4. State field round-trip: loadResumeState preserves all fields including profile
 * 5. Cascade reset on missing artifacts: validateResumeState cascade-resets when manifest missing
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadResumeState,
  validateResumeState,
  resetFromStage,
  findResumableRun,
} from '../resume.js';
import type { SavedPipelineState } from '../resume.js';
import type { StageName, AgentsConfig } from '../types.js';

// Design-only stage order for tests
const DESIGN_STAGES: readonly StageName[] = [
  'intent_consultant',
  'researcher',
  'product_owner',
  'ux_designer',
  'api_designer',
  'ui_designer',
  'validator',
];

// Minimal agents config for validateResumeState tests
const testAgentsConfig: AgentsConfig = {
  agents: {
    researcher: {
      name: 'Researcher',
      prompt_file: '',
      inputs: [],
      outputs: ['research.md', 'research.manifest.json'],
    },
    product_owner: {
      name: 'ProductOwner',
      prompt_file: '',
      inputs: [],
      outputs: ['prd.md', 'prd.manifest.json'],
    },
    ux_designer: {
      name: 'UXDesigner',
      prompt_file: '',
      inputs: [],
      outputs: ['ux-flows.md', 'ux-flows.manifest.json'],
    },
    api_designer: {
      name: 'APIDesigner',
      prompt_file: '',
      inputs: [],
      outputs: ['api-spec.yaml', 'api-spec.manifest.json'],
    },
  },
};

/** Helper: create a SavedPipelineState */
function makeState(
  id: string,
  stages: Partial<Record<StageName, { state: string; retryCount: number }>>,
  extra?: Partial<SavedPipelineState>,
): SavedPipelineState {
  return {
    id,
    instruction: 'test instruction',
    stages: stages as SavedPipelineState['stages'],
    profile: extra?.profile ?? 'design-only',
    autoApprove: extra?.autoApprove ?? false,
    createdAt: extra?.createdAt ?? '2026-01-01T00:00:00Z',
    fixLoopRound: extra?.fixLoopRound,
  };
}

describe('Resume Integration', () => {
  let tmpDir: string;
  let originalCwd: string;
  const RUN_ID = 'test-run-001';

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /** Helper: create run directory and write pipeline-state.json */
  function writeState(state: SavedPipelineState): string {
    const runDir = path.join(tmpDir, '.mosaic', 'artifacts', state.id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'pipeline-state.json'),
      JSON.stringify(state, null, 2),
    );
    return runDir;
  }

  /** Helper: write a dummy artifact file in the run directory */
  function writeArtifact(runDir: string, filename: string, content = 'dummy'): void {
    const filePath = path.join(runDir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  it('Test 1: basic resume resets running states to idle, preserves done states', () => {
    const state = makeState(RUN_ID, {
      intent_consultant: { state: 'done', retryCount: 0 },
      researcher: { state: 'done', retryCount: 0 },
      product_owner: { state: 'done', retryCount: 0 },
      ux_designer: { state: 'running', retryCount: 1 },
      api_designer: { state: 'idle', retryCount: 0 },
    });
    const runDir = writeState(state);

    // Write manifest files for done stages so they pass validation
    writeArtifact(runDir, 'research.manifest.json', '{}');
    writeArtifact(runDir, 'prd.manifest.json', '{}');

    const validated = validateResumeState(state, testAgentsConfig);

    // Done stages preserved
    expect(validated.stages.researcher?.state).toBe('done');
    expect(validated.stages.product_owner?.state).toBe('done');

    // Running state reset to idle
    expect(validated.stages.ux_designer?.state).toBe('idle');
    expect(validated.stages.ux_designer?.retryCount).toBe(0);

    // Already-idle stays idle
    expect(validated.stages.api_designer?.state).toBe('idle');

    // Count done stages: intent_consultant (no agent config, stays done) +
    // researcher + product_owner = 3
    const doneCount = Object.values(validated.stages).filter(
      (s) => s?.state === 'done',
    ).length;
    expect(doneCount).toBe(3);
  });

  it('Test 2: --from reset cleans target+downstream artifacts, preserves upstream', () => {
    const state = makeState(RUN_ID, {
      intent_consultant: { state: 'done', retryCount: 0 },
      researcher: { state: 'done', retryCount: 0 },
      product_owner: { state: 'done', retryCount: 0 },
      ux_designer: { state: 'done', retryCount: 0 },
      api_designer: { state: 'idle', retryCount: 0 },
    });
    const runDir = writeState(state);

    // Write artifacts for each done stage
    writeArtifact(runDir, 'intent-brief.json');
    writeArtifact(runDir, 'research.md');
    writeArtifact(runDir, 'research.manifest.json');
    writeArtifact(runDir, 'prd.md');
    writeArtifact(runDir, 'prd.manifest.json');
    writeArtifact(runDir, 'ux-flows.md');
    writeArtifact(runDir, 'ux-flows.manifest.json');

    // Reset from ux_designer
    resetFromStage(state, 'ux_designer', DESIGN_STAGES);

    // Upstream artifacts still exist
    expect(fs.existsSync(path.join(runDir, 'intent-brief.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'research.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'research.manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'prd.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'prd.manifest.json'))).toBe(true);

    // Upstream states still done
    expect(state.stages.intent_consultant?.state).toBe('done');
    expect(state.stages.researcher?.state).toBe('done');
    expect(state.stages.product_owner?.state).toBe('done');

    // Target + downstream artifacts deleted
    expect(fs.existsSync(path.join(runDir, 'ux-flows.md'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'ux-flows.manifest.json'))).toBe(false);

    // Target + downstream states reset to idle
    expect(state.stages.ux_designer?.state).toBe('idle');
    expect(state.stages.api_designer?.state).toBe('idle');
  });

  it('Test 3: resetFromStage does not delete unrelated files', () => {
    const state = makeState(RUN_ID, {
      intent_consultant: { state: 'done', retryCount: 0 },
      researcher: { state: 'done', retryCount: 0 },
      product_owner: { state: 'done', retryCount: 0 },
    });
    const runDir = writeState(state);

    // Write stage artifacts
    writeArtifact(runDir, 'intent-brief.json');
    writeArtifact(runDir, 'research.md');
    writeArtifact(runDir, 'research.manifest.json');
    writeArtifact(runDir, 'prd.md');
    writeArtifact(runDir, 'prd.manifest.json');

    // Write unrelated files in the run directory
    writeArtifact(runDir, 'run-memory.md', '# Run Memory');
    writeArtifact(runDir, 'custom-note.txt', 'User notes here');

    // Reset from researcher (stage 2)
    resetFromStage(state, 'researcher', DESIGN_STAGES);

    // Stage 1 artifacts intact
    expect(fs.existsSync(path.join(runDir, 'intent-brief.json'))).toBe(true);

    // Unrelated files intact
    expect(fs.existsSync(path.join(runDir, 'run-memory.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'custom-note.txt'))).toBe(true);

    // Target stage artifacts deleted
    expect(fs.existsSync(path.join(runDir, 'research.md'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'research.manifest.json'))).toBe(false);

    // Downstream artifacts also deleted
    expect(fs.existsSync(path.join(runDir, 'prd.md'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'prd.manifest.json'))).toBe(false);
  });

  it('Test 4: loadResumeState preserves all state fields including profile', () => {
    const originalState = makeState(
      RUN_ID,
      {
        researcher: { state: 'done', retryCount: 0 },
        product_owner: { state: 'done', retryCount: 0 },
      },
      {
        profile: 'full',
        autoApprove: true,
        createdAt: '2026-03-15T10:30:00Z',
        fixLoopRound: 2,
      },
    );
    writeState(originalState);

    const loaded = loadResumeState(RUN_ID);

    // All fields round-trip correctly
    expect(loaded.id).toBe(RUN_ID);
    expect(loaded.instruction).toBe('test instruction');
    expect(loaded.profile).toBe('full');
    expect(loaded.autoApprove).toBe(true);
    expect(loaded.createdAt).toBe('2026-03-15T10:30:00Z');
    expect(loaded.fixLoopRound).toBe(2);

    // Stage states preserved exactly
    expect(loaded.stages.researcher?.state).toBe('done');
    expect(loaded.stages.product_owner?.state).toBe('done');
  });

  it('Test 5: validateResumeState cascade-resets when manifest is missing', () => {
    const state = makeState(RUN_ID, {
      researcher: { state: 'done', retryCount: 0 },
      product_owner: { state: 'done', retryCount: 0 },
      ux_designer: { state: 'done', retryCount: 0 },
    });
    const runDir = writeState(state);

    // Write manifests for researcher (stage 1) -- it should stay done
    writeArtifact(runDir, 'research.manifest.json', '{}');

    // DO NOT write prd.manifest.json for product_owner (stage 2)
    // This should trigger cascade reset from product_owner onward

    // Write ux_designer manifest -- but it should still be reset due to cascade
    writeArtifact(runDir, 'ux-flows.manifest.json', '{}');

    const validated = validateResumeState(state, testAgentsConfig);

    // Stage 1: researcher stays done (manifest exists)
    expect(validated.stages.researcher?.state).toBe('done');

    // Stage 2: product_owner cascade-reset (manifest missing)
    expect(validated.stages.product_owner?.state).toBe('idle');
    expect(validated.stages.product_owner?.retryCount).toBe(0);

    // Stage 3: ux_designer cascade-reset (downstream of missing manifest)
    expect(validated.stages.ux_designer?.state).toBe('idle');
    expect(validated.stages.ux_designer?.retryCount).toBe(0);
  });
});
