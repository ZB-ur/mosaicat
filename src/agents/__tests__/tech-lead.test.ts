import { describe, it, expect } from 'vitest';
import type { LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { TechLeadAgent } from '../tech-lead.js';
import {
  createTestRunContext,
  createTestArtifactStore,
} from '../../__tests__/test-helpers.js';
import type { RunContext } from '../../core/run-context.js';

const VALID_MANIFEST = {
  modules: [{ name: 'auth', description: 'Authentication module', covers_features: ['F-001'] }],
  tech_stack: ['Node.js', 'PostgreSQL'],
  implementation_tasks: [{ id: 'T-001', name: 'Setup auth', module: 'auth', covers_features: ['F-001'] }],
};

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
    systemPrompt: '# TechLead Agent',
    task: { runId: 'test-run', stage: 'tech_lead', instruction: 'Create tech spec' },
    inputArtifacts: inputArtifacts ?? new Map(),
  };
}

describe('TechLeadAgent', () => {
  it('reads existing constitution.project.md and appends its update', async () => {
    const existingConstitution = '## Product Constraints\n- Must be offline-first';
    const ctx = makeRunContext({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Use PostgreSQL\n- Max 200ms latency',
    });
    const agent = new TechLeadAgent('tech_lead', ctx);

    const context = makeContext(new Map([
      ['constitution.project.md', existingConstitution],
    ]));
    await agent.execute(context);

    const constitution = ctx.store.read('constitution.project.md');
    expect(constitution).toContain('Product Constraints');
    expect(constitution).toContain('offline-first');
    expect(constitution).toContain('Technical Constraints');
    expect(constitution).toContain('PostgreSQL');
  });

  it('writes constitution.project.md with only its content when no existing constitution', async () => {
    const ctx = makeRunContext({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Use PostgreSQL',
    });
    const agent = new TechLeadAgent('tech_lead', ctx);

    await agent.execute(makeContext());

    const constitution = ctx.store.read('constitution.project.md');
    expect(constitution).toContain('Technical Constraints');
    expect(constitution).toContain('PostgreSQL');
    expect(constitution).not.toContain('Product Constraints');
  });

  it('still writes tech-spec.md and tech-spec.manifest.json normally', async () => {
    const ctx = makeRunContext({
      artifact: '## Tech Spec\nFull technical specification.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Constraint A',
    });
    const agent = new TechLeadAgent('tech_lead', ctx);

    await agent.execute(makeContext());

    const spec = ctx.store.read('tech-spec.md');
    expect(spec).toContain('Full technical specification');

    const manifest = JSON.parse(ctx.store.read('tech-spec.manifest.json'));
    expect(manifest.modules[0].name).toBe('auth');
  });

  it('does NOT write constitution.project.md when field is absent', async () => {
    const ctx = makeRunContext({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
    });
    const agent = new TechLeadAgent('tech_lead', ctx);

    await agent.execute(makeContext());

    expect(ctx.store.exists('constitution.project.md')).toBe(false);
  });
});
