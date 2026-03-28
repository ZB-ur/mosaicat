import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ProductOwnerAgent } from '../product-owner.js';
import { Logger } from '../../core/logger.js';

function makeProvider(response: object): LLMProvider {
  return {
    async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
      return { content: JSON.stringify(response) };
    },
  };
}

function makeContext(inputArtifacts?: Map<string, string>): AgentContext {
  return {
    systemPrompt: '# ProductOwner Agent',
    task: { runId: 'test-run', stage: 'product_owner', instruction: 'Create PRD' },
    inputArtifacts: inputArtifacts ?? new Map(),
  };
}

describe('ProductOwnerAgent', () => {
  beforeEach(() => {
    if (fs.existsSync('.mosaic')) fs.rmSync('.mosaic', { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) fs.rmSync('.mosaic', { recursive: true });
  });

  it('writes constitution.project.md when LLM returns constitution_project field', async () => {
    const provider = makeProvider({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '## Product Constraints\n- Must be offline-first',
    });
    const logger = new Logger('test-run');
    const agent = new ProductOwnerAgent('product_owner', provider, logger);

    await agent.execute(makeContext());

    const constitution = fs.readFileSync('.mosaic/artifacts/test-run/constitution.project.md', 'utf-8');
    expect(constitution).toContain('Product Constraints');
    expect(constitution).toContain('offline-first');
  });

  it('does NOT write constitution.project.md when field is absent', async () => {
    const provider = makeProvider({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
    });
    const logger = new Logger('test-run');
    const agent = new ProductOwnerAgent('product_owner', provider, logger);

    await agent.execute(makeContext());

    expect(fs.existsSync('.mosaic/artifacts/test-run/constitution.project.md')).toBe(false);
  });

  it('does NOT write constitution.project.md when field is empty', async () => {
    const provider = makeProvider({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '   ',
    });
    const logger = new Logger('test-run');
    const agent = new ProductOwnerAgent('product_owner', provider, logger);

    await agent.execute(makeContext());

    expect(fs.existsSync('.mosaic/artifacts/test-run/constitution.project.md')).toBe(false);
  });

  it('still writes prd.md and prd.manifest.json normally', async () => {
    const provider = makeProvider({
      artifact: '## PRD\nFull product requirements document.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '## Product Constraints\n- Constraint A',
    });
    const logger = new Logger('test-run');
    const agent = new ProductOwnerAgent('product_owner', provider, logger);

    await agent.execute(makeContext());

    const prd = fs.readFileSync('.mosaic/artifacts/test-run/prd.md', 'utf-8');
    expect(prd).toContain('Full product requirements document');

    const manifest = JSON.parse(fs.readFileSync('.mosaic/artifacts/test-run/prd.manifest.json', 'utf-8'));
    expect(manifest.features).toHaveLength(1);
    expect(manifest.features[0].id).toBe('F-001');
  });
});
