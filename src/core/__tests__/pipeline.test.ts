import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Pipeline } from '../pipeline.js';
import { EventBus } from '../event-bus.js';
import { Logger } from '../logger.js';
import { SnapshotManager } from '../snapshot.js';
import { StubAgent } from '../agent.js';
import { ContextManager } from '../context-manager.js';
import { createLLMProvider } from '../llm-provider.js';
import type { PipelineConfig, StageName, Task, AgentsConfig } from '../types.js';
import { STAGE_ORDER } from '../types.js';

function createTestConfig(): PipelineConfig {
  return {
    stages: {
      researcher: { clarification: true, gate: 'auto' },
      product_owner: { clarification: false, gate: 'manual' },
      ux_designer: { clarification: true, gate: 'auto' },
      api_designer: { clarification: true, gate: 'auto' },
      ui_designer: { clarification: false, gate: 'manual' },
      validator: { clarification: false, gate: 'auto' },
    },
    pipeline: { max_retries_per_stage: 3, snapshot: 'on_stage_complete' },
  };
}

function createAgentsConfig(): AgentsConfig {
  return {
    agents: {
      researcher: { input: ['user_instruction'], output: ['research.md', 'research.manifest.json'], prompt: 'prompt.md' },
      product_owner: { input: ['user_instruction', 'research.md'], output: ['prd.md', 'prd.manifest.json'], prompt: 'prompt.md' },
      ux_designer: { input: ['prd.md'], output: ['ux-flows.md', 'ux-flows.manifest.json'], prompt: 'prompt.md' },
      api_designer: { input: ['prd.md', 'ux-flows.md'], output: ['api-spec.yaml', 'api-spec.manifest.json'], prompt: 'prompt.md' },
      ui_designer: { input: ['prd.md', 'ux-flows.md', 'api-spec.yaml'], output: ['components/', 'screenshots/', 'components.manifest.json'], prompt: 'prompt.md' },
      validator: { input: ['*.manifest.json'], output: ['validation-report.md'], prompt: 'prompt.md' },
    },
  };
}

describe('Pipeline', () => {
  let tmpDir: string;
  let eventBus: EventBus;
  let logger: Logger;
  let pipeline: Pipeline;

  const task: Task = {
    id: 'test-task',
    instruction: 'Build a test app',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaicat-pipe-'));
    // Create a dummy prompt file
    fs.writeFileSync(path.join(tmpDir, 'prompt.md'), '# Agent');

    eventBus = new EventBus();
    logger = new Logger(path.join(tmpDir, 'logs'), 'test');
    const snapshotManager = new SnapshotManager(tmpDir, logger);
    const agentsConfig = createAgentsConfig();
    const contextManager = new ContextManager(agentsConfig, tmpDir);
    const llmProvider = createLLMProvider('stub');

    const agents = new Map<StageName, StubAgent>();
    for (const stage of STAGE_ORDER) {
      agents.set(stage, new StubAgent(stage, {
        eventBus,
        logger,
        llmProvider,
        contextManager,
        projectRoot: tmpDir,
      }));
    }

    pipeline = new Pipeline(
      createTestConfig(),
      eventBus,
      logger,
      snapshotManager,
      agents,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should run all 6 stages with auto-approve', async () => {
    const completedStages: StageName[] = [];
    eventBus.on('stage:completed', (stage) => {
      completedStages.push(stage);
    });

    const run = await pipeline.start(task, true);

    expect(run.status).toBe('completed');
    expect(completedStages).toEqual(STAGE_ORDER);
  });

  it('should pause at manual gate without auto-approve', async () => {
    const awaitingStages: StageName[] = [];
    eventBus.on('stage:awaiting_human', (stage) => {
      awaitingStages.push(stage);
      // Auto-approve after detecting the pause
      setTimeout(() => pipeline.approve(), 10);
    });

    const run = await pipeline.start(task, false);

    expect(run.status).toBe('completed');
    // product_owner and ui_designer have manual gates
    expect(awaitingStages).toContain('product_owner');
    expect(awaitingStages).toContain('ui_designer');
  });

  it('should report status correctly', () => {
    const status = pipeline.getStatus();
    expect(status.pipeline).toBe('idle');
    expect(status.run).toBeNull();
  });
});
