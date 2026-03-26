import { describe, it, expect, beforeEach } from 'vitest';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { Logger } from '../../core/logger.js';
import { EventBus } from '../../core/event-bus.js';
import type { AgentContext } from '../../core/types.js';
import type { ArtifactIO, CoderDeps } from '../coder/types.js';
import { CoderPlanner } from '../coder/coder-planner.js';

// --- Mock helpers ---

function createMockProvider(response: string): LLMProvider {
  return {
    async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
      return { content: response };
    },
  };
}

function createMockLogger(): Logger {
  return {
    pipeline: () => {},
    agent: () => {},
  } as unknown as Logger;
}

function createMockArtifacts(): ArtifactIO & { stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    stored,
    write(name: string, content: string) { stored.set(name, content); },
    read(name: string) {
      const v = stored.get(name);
      if (v === undefined) throw new Error(`Artifact not found: ${name}`);
      return v;
    },
    exists(name: string) { return stored.has(name); },
    getDir() { return '/tmp/test-artifacts'; },
  };
}

function makeDeps(overrides?: Partial<CoderDeps>): CoderDeps {
  return {
    stage: 'coder' as const,
    provider: createMockProvider(''),
    artifacts: createMockArtifacts(),
    logger: createMockLogger(),
    eventBus: new EventBus(),
    ...overrides,
  };
}

function makeContext(): AgentContext {
  return {
    systemPrompt: '# Coder',
    task: { runId: 'test-run', stage: 'coder', instruction: 'Build' },
    inputArtifacts: new Map([
      ['tech-spec.md', '## Tech Spec\nBuild a todo app'],
      ['api-spec.yaml', 'openapi: 3.0.0'],
    ]),
  };
}

const VALID_PLAN_JSON = JSON.stringify({
  project_name: 'todo-app',
  tech_stack: { language: 'TypeScript', framework: 'React', build_tool: 'vite' },
  commands: { setupCommand: 'npm install', verifyCommand: 'npx tsc --noEmit', buildCommand: 'npm run build' },
  modules: [
    {
      name: 'core',
      description: 'Core module',
      files: ['src/App.tsx'],
      dependencies: [],
      covers_tasks: ['T1'],
      covers_features: ['F-001'],
      priority: 1,
    },
  ],
});

describe('CoderPlanner', () => {
  let artifacts: ReturnType<typeof createMockArtifacts>;
  let deps: CoderDeps;

  beforeEach(() => {
    artifacts = createMockArtifacts();
    deps = makeDeps({ artifacts });
  });

  it('createPlan() calls provider and returns parsed CodePlan', async () => {
    const responseContent = `Here is the plan:\n<!-- ARTIFACT:code-plan.json -->${VALID_PLAN_JSON}<!-- END:code-plan.json -->`;
    const provider = createMockProvider(responseContent);
    const planner = new CoderPlanner(makeDeps({ provider, artifacts }));

    const plan = await planner.createPlan(makeContext());

    expect(plan.project_name).toBe('todo-app');
    expect(plan.modules).toHaveLength(1);
    expect(plan.modules[0].name).toBe('core');
  });

  it('createPlan() throws when LLM response has no ARTIFACT block and no JSON', async () => {
    const provider = createMockProvider('I cannot produce a plan right now.');
    const planner = new CoderPlanner(makeDeps({ provider, artifacts }));

    await expect(planner.createPlan(makeContext())).rejects.toThrow();
  });

  it('createPlan() writes code-plan.json to artifacts', async () => {
    const responseContent = `<!-- ARTIFACT:code-plan.json -->${VALID_PLAN_JSON}<!-- END:code-plan.json -->`;
    const provider = createMockProvider(responseContent);
    const planner = new CoderPlanner(makeDeps({ provider, artifacts }));

    await planner.createPlan(makeContext());

    expect(artifacts.stored.has('code-plan.json')).toBe(true);
    const written = JSON.parse(artifacts.stored.get('code-plan.json')!);
    expect(written.project_name).toBe('todo-app');
  });

  it('loadExistingPlan() returns parsed plan when code-plan.json exists', () => {
    artifacts.write('code-plan.json', VALID_PLAN_JSON);
    const planner = new CoderPlanner(makeDeps({ artifacts }));

    const plan = planner.loadExistingPlan();

    expect(plan).not.toBeNull();
    expect(plan!.project_name).toBe('todo-app');
    expect(plan!.modules).toHaveLength(1);
  });

  it('loadExistingPlan() returns null when code-plan.json does not exist', () => {
    const planner = new CoderPlanner(deps);

    const plan = planner.loadExistingPlan();

    expect(plan).toBeNull();
  });
});
