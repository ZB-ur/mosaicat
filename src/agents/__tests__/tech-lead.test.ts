import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { TechLeadAgent } from '../tech-lead.js';
import { Logger } from '../../core/logger.js';
import { initArtifactsDir } from '../../core/artifact.js';

const VALID_MANIFEST = {
  modules: [{ name: 'auth', description: 'Authentication module', covers_features: ['F-001'] }],
  tech_stack: ['Node.js', 'PostgreSQL'],
  implementation_tasks: [{ id: 'T-001', name: 'Setup auth', module: 'auth', covers_features: ['F-001'] }],
};

function makeProvider(response: object): LLMProvider {
  return {
    async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
      return { content: JSON.stringify(response) };
    },
  };
}

function makeContext(inputArtifacts?: Map<string, string>): AgentContext {
  return {
    systemPrompt: '# TechLead Agent',
    task: { runId: 'test-run', stage: 'tech_lead', instruction: 'Create tech spec' },
    inputArtifacts: inputArtifacts ?? new Map(),
  };
}

describe('TechLeadAgent', () => {
  beforeEach(() => {
    if (fs.existsSync('.mosaic')) fs.rmSync('.mosaic', { recursive: true });
    initArtifactsDir('test-run');
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) fs.rmSync('.mosaic', { recursive: true });
  });

  it('reads existing constitution.project.md and appends its update', async () => {
    const existingConstitution = '## Product Constraints\n- Must be offline-first';
    const provider = makeProvider({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Use PostgreSQL\n- Max 200ms latency',
    });
    const logger = new Logger('test-run');
    const agent = new TechLeadAgent('tech_lead', provider, logger);

    const context = makeContext(new Map([
      ['constitution.project.md', existingConstitution],
    ]));
    await agent.execute(context);

    const constitution = fs.readFileSync('.mosaic/artifacts/test-run/constitution.project.md', 'utf-8');
    expect(constitution).toContain('Product Constraints');
    expect(constitution).toContain('offline-first');
    expect(constitution).toContain('Technical Constraints');
    expect(constitution).toContain('PostgreSQL');
  });

  it('writes constitution.project.md with only its content when no existing constitution', async () => {
    const provider = makeProvider({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Use PostgreSQL',
    });
    const logger = new Logger('test-run');
    const agent = new TechLeadAgent('tech_lead', provider, logger);

    await agent.execute(makeContext());

    const constitution = fs.readFileSync('.mosaic/artifacts/test-run/constitution.project.md', 'utf-8');
    expect(constitution).toContain('Technical Constraints');
    expect(constitution).toContain('PostgreSQL');
    expect(constitution).not.toContain('Product Constraints');
  });

  it('still writes tech-spec.md and tech-spec.manifest.json normally', async () => {
    const provider = makeProvider({
      artifact: '## Tech Spec\nFull technical specification.',
      manifest: VALID_MANIFEST,
      constitution_project_update: '## Technical Constraints\n- Constraint A',
    });
    const logger = new Logger('test-run');
    const agent = new TechLeadAgent('tech_lead', provider, logger);

    await agent.execute(makeContext());

    const spec = fs.readFileSync('.mosaic/artifacts/test-run/tech-spec.md', 'utf-8');
    expect(spec).toContain('Full technical specification');

    const manifest = JSON.parse(fs.readFileSync('.mosaic/artifacts/test-run/tech-spec.manifest.json', 'utf-8'));
    expect(manifest.modules[0].name).toBe('auth');
  });

  it('does NOT write constitution.project.md when field is absent', async () => {
    const provider = makeProvider({
      artifact: '## Tech Spec\nArchitecture decisions.',
      manifest: VALID_MANIFEST,
    });
    const logger = new Logger('test-run');
    const agent = new TechLeadAgent('tech_lead', provider, logger);

    await agent.execute(makeContext());

    expect(fs.existsSync('.mosaic/artifacts/test-run/constitution.project.md')).toBe(false);
  });
});
