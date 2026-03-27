import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { Logger } from '../../core/logger.js';
import type { InteractionHandler } from '../../core/interaction-handler.js';
import type { AgentContext, StageName, Task } from '../../core/types.js';
import type { RunContext } from '../../core/run-context.js';
import { EventBus } from '../../core/event-bus.js';
import { createTestArtifactStore } from '../../__tests__/test-helpers.js';

// Mock sub-modules before importing CoderAgent
const mockCreatePlan = vi.fn();
const mockLoadExistingPlan = vi.fn();
const mockRunSkeleton = vi.fn();
const mockIsSkeletonComplete = vi.fn();
const mockRunSkeletonFix = vi.fn();
const mockGetModulesToImplement = vi.fn();
const mockImplementModule = vi.fn();
const mockImplementModuleWithErrors = vi.fn();
const mockRunSetupCommand = vi.fn();
const mockRunVerifyCommand = vi.fn();
const mockRunBuildCommand = vi.fn();
const mockRunBuildFix = vi.fn();
const mockAnalyzeBuildArtifacts = vi.fn();
const mockRunAcceptanceTests = vi.fn();
const mockAskUserToRetry = vi.fn();
const mockRunSmokeTest = vi.fn();
const mockGenerateManifest = vi.fn();
const mockGenerateReadme = vi.fn();

// Use class-based mocks to support `new` operator
class MockCoderPlanner {
  createPlan = mockCreatePlan;
  loadExistingPlan = mockLoadExistingPlan;
}

class MockCoderBuilder {
  runSkeleton = mockRunSkeleton;
  isSkeletonComplete = mockIsSkeletonComplete;
  runSkeletonFix = mockRunSkeletonFix;
  getModulesToImplement = mockGetModulesToImplement;
  implementModule = mockImplementModule;
  implementModuleWithErrors = mockImplementModuleWithErrors;
}

class MockBuildVerifier {
  runSetupCommand = mockRunSetupCommand;
  runVerifyCommand = mockRunVerifyCommand;
  runBuildCommand = mockRunBuildCommand;
  runBuildFix = mockRunBuildFix;
  analyzeBuildArtifacts = mockAnalyzeBuildArtifacts;
  runAcceptanceTests = mockRunAcceptanceTests;
  askUserToRetry = mockAskUserToRetry;
}

class MockSmokeRunner {
  runSmokeTest = mockRunSmokeTest;
}

class MockOutputGenerator {
  generateManifest = mockGenerateManifest;
  generateReadme = mockGenerateReadme;
}

vi.mock('../coder/coder-planner.js', () => ({
  CoderPlanner: MockCoderPlanner,
}));

vi.mock('../coder/coder-builder.js', () => ({
  CoderBuilder: MockCoderBuilder,
  BUILDER_PROMPT_PATH: '.claude/agents/mosaic/code-builder.md',
}));

vi.mock('../coder/build-verifier.js', () => ({
  BuildVerifier: MockBuildVerifier,
  AUTO_FIX_RETRIES: 3,
}));

vi.mock('../coder/smoke-runner.js', () => ({
  SmokeRunner: MockSmokeRunner,
}));

vi.mock('../coder/output-generator.js', () => ({
  OutputGenerator: MockOutputGenerator,
}));

vi.mock('../../core/artifact.js', () => ({
  writeArtifact: vi.fn(),
  readArtifact: vi.fn(),
  artifactExists: vi.fn().mockReturnValue(false),
  getArtifactsDir: vi.fn().mockReturnValue('/tmp/test-artifacts'),
}));

vi.mock('../../core/event-bus.js', () => {
  class MockEventBus {
    emit = vi.fn();
    on = vi.fn();
    off = vi.fn();
  }
  return {
    eventBus: new MockEventBus(),
    EventBus: MockEventBus,
  };
});

vi.mock('../../core/manifest.js', () => ({
  writeManifest: vi.fn(),
}));

vi.mock('../../core/retry-log.js', () => ({
  logRetry: vi.fn(),
  classifyError: vi.fn().mockReturnValue('unknown'),
}));

// --- Helpers ---

function createMockProvider(): LLMProvider {
  return {
    async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
      return { content: 'mock response' };
    },
  };
}

function createMockLogger(): Logger {
  return {
    pipeline: vi.fn(),
    agent: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger;
}

function createMockRunContext(): RunContext {
  const provider = createMockProvider();
  const logger = createMockLogger();
  const store = createTestArtifactStore();
  const eventBus = new EventBus();
  return {
    store,
    logger,
    provider,
    eventBus,
    config: {} as any,
    signal: new AbortController().signal,
    devMode: true,
  };
}

function createMockContext(): AgentContext {
  const task: Task = {
    runId: 'test-run-1',
    stage: 'coder',
    instruction: 'test instruction',
    autonomy: { max_budget_usd: 5 },
  };
  return {
    task,
    inputArtifacts: new Map(),
    systemPrompt: '',
  };
}

const MOCK_PLAN = {
  project_name: 'test-project',
  modules: [
    {
      name: 'core',
      description: 'Core module',
      files: ['src/index.ts'],
      priority: 1,
      dependencies: [],
      covers_features: ['F-001'],
      covers_tasks: ['T-001'],
    },
  ],
  tech_stack: { language: 'TypeScript', framework: 'Express', build_tool: 'tsc' },
  commands: {
    setupCommand: 'npm install',
    verifyCommand: 'npx tsc --noEmit',
    buildCommand: 'npm run build',
  },
  smokeTest: { type: 'web' as const, startCommand: 'npm start', port: 3000 },
};

describe('CoderAgent Facade', () => {
  let CoderAgent: typeof import('../coder.js').CoderAgent;
  let CoderPlanner: typeof import('../coder/coder-planner.js').CoderPlanner;
  let CoderBuilder: typeof import('../coder/coder-builder.js').CoderBuilder;
  let BuildVerifier: typeof import('../coder/build-verifier.js').BuildVerifier;
  let SmokeRunner: typeof import('../coder/smoke-runner.js').SmokeRunner;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock behaviors
    mockLoadExistingPlan.mockReturnValue(null);
    mockCreatePlan.mockResolvedValue(MOCK_PLAN);
    mockIsSkeletonComplete.mockReturnValue(false);
    mockRunSkeleton.mockResolvedValue(undefined);
    mockGetModulesToImplement.mockReturnValue([]);
    mockRunVerifyCommand.mockReturnValue({ success: true, errors: '' });
    mockRunBuildCommand.mockReturnValue({ success: true, errors: '' });
    mockRunAcceptanceTests.mockResolvedValue(undefined);
    mockRunSmokeTest.mockResolvedValue(undefined);

    // Import fresh each time (mocks already applied)
    const coderMod = await import('../coder.js');
    CoderAgent = coderMod.CoderAgent;
    const plannerMod = await import('../coder/coder-planner.js');
    CoderPlanner = plannerMod.CoderPlanner;
    const builderMod = await import('../coder/coder-builder.js');
    CoderBuilder = builderMod.CoderBuilder;
    const verifierMod = await import('../coder/build-verifier.js');
    BuildVerifier = verifierMod.BuildVerifier;
    const smokerMod = await import('../coder/smoke-runner.js');
    SmokeRunner = smokerMod.SmokeRunner;
  });

  it('constructs with (stage, provider, logger) -- no interactionHandler', () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    expect(agent).toBeDefined();
    expect(agent.stage).toBe('coder');
  });

  it('constructs with (stage, provider, logger, interactionHandler)', () => {
    const handler: InteractionHandler = {
      onClarification: vi.fn(),
      onGateReview: vi.fn(),
    } as unknown as InteractionHandler;
    const agent = new CoderAgent('coder', createMockRunContext(), handler);
    expect(agent).toBeDefined();
  });

  it('creates and uses all 4 sub-module instances on run()', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    // Verify all 4 sub-modules were used (their methods were called)
    expect(mockLoadExistingPlan).toHaveBeenCalled(); // CoderPlanner
    expect(mockIsSkeletonComplete).toHaveBeenCalled(); // CoderBuilder
    expect(mockRunSetupCommand).toHaveBeenCalled(); // BuildVerifier
    expect(mockRunSmokeTest).toHaveBeenCalled(); // SmokeRunner
  });

  it('calls planner.loadExistingPlan() first', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockLoadExistingPlan).toHaveBeenCalledTimes(1);
  });

  it('calls planner.createPlan() when no existing plan', async () => {
    mockLoadExistingPlan.mockReturnValue(null);
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockCreatePlan).toHaveBeenCalledTimes(1);
    expect(mockCreatePlan).toHaveBeenCalledWith(context);
  });

  it('skips createPlan when loadExistingPlan returns a plan', async () => {
    mockLoadExistingPlan.mockReturnValue(MOCK_PLAN);
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockCreatePlan).not.toHaveBeenCalled();
  });

  it('calls builder.runSkeleton() when skeleton not complete', async () => {
    mockIsSkeletonComplete.mockReturnValue(false);
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunSkeleton).toHaveBeenCalledTimes(1);
  });

  it('skips skeleton when builder.isSkeletonComplete() returns true', async () => {
    mockIsSkeletonComplete.mockReturnValue(true);
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunSkeleton).not.toHaveBeenCalled();
  });

  it('calls verifier.runSetupCommand()', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunSetupCommand).toHaveBeenCalled();
  });

  it('calls verifier.runVerifyCommand() for skeleton check', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunVerifyCommand).toHaveBeenCalled();
  });

  it('calls verifier.runBuildCommand() for final build', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunBuildCommand).toHaveBeenCalled();
  });

  it('calls smoker.runSmokeTest()', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunSmokeTest).toHaveBeenCalled();
  });

  it('calls verifier.runAcceptanceTests()', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockRunAcceptanceTests).toHaveBeenCalled();
  });

  it('calls verifier.analyzeBuildArtifacts()', async () => {
    const agent = new CoderAgent('coder', createMockRunContext());
    const context = createMockContext();
    await agent.execute(context);

    expect(mockAnalyzeBuildArtifacts).toHaveBeenCalled();
  });

  it('coder.ts file is under 250 lines', () => {
    const coderPath = path.resolve(import.meta.dirname, '../coder.ts');
    const lines = fs.readFileSync(coderPath, 'utf-8').split('\n').length;
    expect(lines).toBeLessThan(250);
  });
});
