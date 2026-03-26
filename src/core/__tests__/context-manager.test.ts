import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { buildContext } from '../context-manager.js';
import type { AgentsConfig, Task } from '../types.js';
import { createTestArtifactStore, createMockLogger } from '../../__tests__/test-helpers.js';
import type { ArtifactStore } from '../artifact-store.js';
import type { Logger } from '../logger.js';

const mockAgentsConfig: AgentsConfig = {
  agents: {
    researcher: {
      name: 'Researcher',
      prompt_file: '.claude/agents/mosaic/researcher.md',
      inputs: ['user_instruction'],
      outputs: ['research.md', 'research.manifest.json'],
    },
    product_owner: {
      name: 'ProductOwner',
      prompt_file: '.claude/agents/mosaic/product-owner.md',
      inputs: ['user_instruction', 'research.md'],
      outputs: ['prd.md', 'prd.manifest.json'],
    },
    ux_designer: {
      name: 'UXDesigner',
      prompt_file: '.claude/agents/mosaic/ux-designer.md',
      inputs: ['prd.md'],
      outputs: ['ux-flows.md', 'ux-flows.manifest.json'],
    },
    api_designer: {
      name: 'APIDesigner',
      prompt_file: '.claude/agents/mosaic/api-designer.md',
      inputs: ['prd.md', 'ux-flows.md'],
      outputs: ['api-spec.yaml', 'api-spec.manifest.json'],
    },
    ui_designer: {
      name: 'UIDesigner',
      prompt_file: '.claude/agents/mosaic/ui-designer.md',
      inputs: ['prd.md', 'ux-flows.md', 'api-spec.yaml'],
      outputs: ['components/', 'screenshots/', 'components.manifest.json'],
    },
    validator: {
      name: 'Validator',
      prompt_file: '.claude/agents/mosaic/validator.md',
      inputs: ['research.manifest.json', 'prd.manifest.json', 'ux-flows.manifest.json', 'api-spec.manifest.json', 'components.manifest.json'],
      outputs: ['validation-report.md'],
    },
  },
};

describe('ContextManager', () => {
  let store: ArtifactStore;
  let logger: Logger;

  beforeEach(() => {
    store = createTestArtifactStore();
    logger = createMockLogger();
  });

  afterEach(() => {
    if (store && fs.existsSync(store.runDir)) {
      fs.rmSync(store.runDir, { recursive: true, force: true });
    }
  });

  it('should include user_instruction for researcher', () => {
    const task: Task = { runId: 'run-1', stage: 'researcher', instruction: 'build a blog' };
    const ctx = buildContext(mockAgentsConfig, task, store, logger, true);
    expect(ctx.inputArtifacts.get('user_instruction')).toBe('build a blog');
    expect(ctx.inputArtifacts.size).toBe(1);
  });

  it('should only include contracted artifacts for ux_designer', () => {
    store.write('prd.md', 'PRD content');
    store.write('research.md', 'Research content — should NOT be visible');

    const task: Task = { runId: 'run-1', stage: 'ux_designer', instruction: 'test' };
    const ctx = buildContext(mockAgentsConfig, task, store, logger, true);

    expect(ctx.inputArtifacts.has('prd.md')).toBe(true);
    expect(ctx.inputArtifacts.has('research.md')).toBe(false);
  });

  it('should skip missing artifacts gracefully', () => {
    const task: Task = { runId: 'run-1', stage: 'api_designer', instruction: 'test' };
    const ctx = buildContext(mockAgentsConfig, task, store, logger, true);
    expect(ctx.inputArtifacts.size).toBe(0);
  });

  it('should throw when prompt file missing in non-dev mode', () => {
    const task: Task = { runId: 'run-1', stage: 'researcher', instruction: 'test' };
    expect(() => buildContext(mockAgentsConfig, task, store, logger, false)).toThrow('Required prompt file missing');
  });

  it('should warn when prompt file missing in dev mode', () => {
    const task: Task = { runId: 'run-1', stage: 'researcher', instruction: 'test' };
    const ctx = buildContext(mockAgentsConfig, task, store, logger, true);
    expect(ctx.systemPrompt).toContain('You are the Researcher agent.');
    expect(logger.pipeline).toHaveBeenCalledWith('warn', 'context:prompt-missing', expect.any(Object));
  });
});
