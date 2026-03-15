import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { EventBus } from './event-bus.js';
import { Logger } from './logger.js';
import { Pipeline } from './pipeline.js';
import { SnapshotManager } from './snapshot.js';
import { ContextManager } from './context-manager.js';
import { StubAgent } from './agent.js';
import { createLLMProvider } from './llm-provider.js';
import {
  PipelineConfigSchema,
  AgentsConfigSchema,
  STAGE_ORDER,
  type StageName,
  type PipelineConfig,
  type AgentsConfig,
  type Task,
} from './types.js';
import type { BaseAgent } from './agent.js';

export class Orchestrator {
  private eventBus: EventBus;
  private logger: Logger;
  private pipeline: Pipeline | null = null;
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;

  constructor(private projectRoot: string = '.') {
    this.eventBus = new EventBus();
    this.pipelineConfig = this.loadPipelineConfig();
    this.agentsConfig = this.loadAgentsConfig();

    const runId = Date.now().toString();
    this.logger = new Logger(
      path.resolve(projectRoot, '.mosaic/logs'),
      runId,
    );
    this.logger.subscribe(this.eventBus);
  }

  async run(instruction: string, autoApprove = false): Promise<void> {
    const task: Task = {
      id: `task-${Date.now()}`,
      instruction,
      createdAt: new Date().toISOString(),
    };

    const llmProvider = createLLMProvider('stub');
    const contextManager = new ContextManager(this.agentsConfig, this.projectRoot);
    const snapshotManager = new SnapshotManager(this.projectRoot, this.logger);

    const agents = new Map<StageName, BaseAgent>();
    for (const stage of STAGE_ORDER) {
      agents.set(
        stage,
        new StubAgent(stage, {
          eventBus: this.eventBus,
          logger: this.logger,
          llmProvider,
          contextManager,
          projectRoot: this.projectRoot,
        }),
      );
    }

    this.pipeline = new Pipeline(
      this.pipelineConfig,
      this.eventBus,
      this.logger,
      snapshotManager,
      agents,
    );

    const run = await this.pipeline.start(task, autoApprove);
    console.log(`\nPipeline completed: ${run.id}`);
    console.log(`Artifacts: ${path.resolve(this.projectRoot, '.mosaic/artifacts')}`);
    console.log(`Logs: ${this.logger.runDirectory}`);
  }

  approve(): void {
    this.pipeline?.approve();
  }

  reject(): void {
    this.pipeline?.reject();
  }

  getStatus() {
    return this.pipeline?.getStatus() ?? { pipeline: 'idle', run: null };
  }

  private loadPipelineConfig(): PipelineConfig {
    const filePath = path.resolve(this.projectRoot, 'config/pipeline.yaml');
    const content = fs.readFileSync(filePath, 'utf-8');
    const raw = yaml.load(content);
    return PipelineConfigSchema.parse(raw);
  }

  private loadAgentsConfig(): AgentsConfig {
    const filePath = path.resolve(this.projectRoot, 'config/agents.yaml');
    const content = fs.readFileSync(filePath, 'utf-8');
    const raw = yaml.load(content);
    return AgentsConfigSchema.parse(raw);
  }
}
