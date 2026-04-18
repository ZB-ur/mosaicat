import { describe, it, expect, beforeEach } from 'vitest';
import type { LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ProductOwnerAgent } from '../product-owner.js';
import {
  createTestRunContext,
  createTestArtifactStore,
} from '../../__tests__/test-helpers.js';
import type { RunContext } from '../../core/run-context.js';

function makeRunContext(response: object): RunContext {
  const store = createTestArtifactStore();
  return createTestRunContext({
    store,
    provider: {
      async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
        return { content: JSON.stringify(response) };
      },
    },
  });
}

function makeContext(inputArtifacts?: Map<string, string>): AgentContext {
  return {
    systemPrompt: '# ProductOwner Agent',
    task: { runId: 'test-run', stage: 'product_owner', instruction: 'Create PRD' },
    inputArtifacts: inputArtifacts ?? new Map(),
  };
}

describe('ProductOwnerAgent', () => {
  it('writes constitution.project.md when LLM returns constitution_project field', async () => {
    const ctx = makeRunContext({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '## Product Constraints\n- Must be offline-first',
    });
    const agent = new ProductOwnerAgent('product_owner', ctx);

    await agent.execute(makeContext());

    const constitution = ctx.store.read('constitution.project.md');
    expect(constitution).toContain('Product Constraints');
    expect(constitution).toContain('offline-first');
  });

  it('does NOT write constitution.project.md when field is absent', async () => {
    const ctx = makeRunContext({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
    });
    const agent = new ProductOwnerAgent('product_owner', ctx);

    await agent.execute(makeContext());

    expect(ctx.store.exists('constitution.project.md')).toBe(false);
  });

  it('does NOT write constitution.project.md when field is empty', async () => {
    const ctx = makeRunContext({
      artifact: '## PRD Content\nSome product requirements.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '   ',
    });
    const agent = new ProductOwnerAgent('product_owner', ctx);

    await agent.execute(makeContext());

    expect(ctx.store.exists('constitution.project.md')).toBe(false);
  });

  it('still writes prd.md and prd.manifest.json normally', async () => {
    const ctx = makeRunContext({
      artifact: '## PRD\nFull product requirements document.',
      manifest: { features: [{ id: 'F-001', name: 'feature-1' }], constraints: ['c1'], out_of_scope: ['o1'] },
      constitution_project: '## Product Constraints\n- Constraint A',
    });
    const agent = new ProductOwnerAgent('product_owner', ctx);

    await agent.execute(makeContext());

    const prd = ctx.store.read('prd.md');
    expect(prd).toContain('Full product requirements document');

    const manifest = JSON.parse(ctx.store.read('prd.manifest.json'));
    expect(manifest.features).toHaveLength(1);
    expect(manifest.features[0].id).toBe('F-001');
  });
});
