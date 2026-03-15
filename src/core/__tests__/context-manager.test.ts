import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ContextManager } from '../context-manager.js';
import { writeArtifact } from '../artifact.js';
import type { AgentsConfig, Task } from '../types.js';

const AGENTS_CONFIG: AgentsConfig = {
  agents: {
    researcher: {
      input: ['user_instruction'],
      output: ['research.md', 'research.manifest.json'],
      prompt: '.claude/agents/mosaic/researcher.md',
    },
    product_owner: {
      input: ['user_instruction', 'research.md'],
      output: ['prd.md', 'prd.manifest.json'],
      prompt: '.claude/agents/mosaic/product-owner.md',
    },
    ux_designer: {
      input: ['prd.md'],
      output: ['ux-flows.md', 'ux-flows.manifest.json'],
      prompt: '.claude/agents/mosaic/ux-designer.md',
    },
    api_designer: {
      input: ['prd.md', 'ux-flows.md'],
      output: ['api-spec.yaml', 'api-spec.manifest.json'],
      prompt: '.claude/agents/mosaic/api-designer.md',
    },
    ui_designer: {
      input: ['prd.md', 'ux-flows.md', 'api-spec.yaml'],
      output: ['components/', 'screenshots/', 'components.manifest.json'],
      prompt: '.claude/agents/mosaic/ui-designer.md',
    },
    validator: {
      input: ['*.manifest.json'],
      output: ['validation-report.md'],
      prompt: '.claude/agents/mosaic/validator.md',
    },
  },
};

describe('ContextManager', () => {
  let tmpDir: string;
  let manager: ContextManager;

  const task: Task = {
    id: 'test-task',
    instruction: 'Build a todo app',
    createdAt: new Date().toISOString(),
  };

  const stageConfig = { clarification: true, gate: 'auto' as const };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaicat-ctx-'));
    // Create a prompt file
    const promptDir = path.join(tmpDir, '.claude/agents/mosaic');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(path.join(promptDir, 'researcher.md'), '# Researcher');
    fs.writeFileSync(path.join(promptDir, 'ux-designer.md'), '# UX Designer');
    fs.writeFileSync(path.join(promptDir, 'validator.md'), '# Validator');
    manager = new ContextManager(AGENTS_CONFIG, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should include user_instruction for researcher', () => {
    const ctx = manager.buildContext('researcher', task, stageConfig);
    expect(ctx.inputArtifacts).toHaveLength(1);
    expect(ctx.inputArtifacts[0].name).toBe('user_instruction');
    expect(ctx.inputArtifacts[0].content).toBe('Build a todo app');
  });

  it('should only return contract-specified artifacts for ux_designer', () => {
    // Write artifacts that ux_designer should see
    writeArtifact('prd.md', '# PRD', tmpDir);
    // Write artifacts that ux_designer should NOT see
    writeArtifact('research.md', '# Research', tmpDir);
    writeArtifact('api-spec.yaml', 'openapi: 3.0', tmpDir);

    const ctx = manager.buildContext('ux_designer', task, stageConfig);
    const names = ctx.inputArtifacts.map((a) => a.name);

    expect(names).toContain('prd.md');
    expect(names).not.toContain('research.md');
    expect(names).not.toContain('api-spec.yaml');
  });

  it('should resolve glob patterns for validator', () => {
    writeArtifact('prd.manifest.json', '{"features":[]}', tmpDir);
    writeArtifact('research.manifest.json', '{"competitors":[]}', tmpDir);
    writeArtifact('prd.md', '# Not a manifest', tmpDir);

    const ctx = manager.buildContext('validator', task, stageConfig);
    const names = ctx.inputArtifacts.map((a) => a.name);

    expect(names).toContain('prd.manifest.json');
    expect(names).toContain('research.manifest.json');
    expect(names).not.toContain('prd.md');
  });

  it('should load system prompt from prompt file', () => {
    const ctx = manager.buildContext('researcher', task, stageConfig);
    expect(ctx.systemPrompt).toBe('# Researcher');
  });
});
