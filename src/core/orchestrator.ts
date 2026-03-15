import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig, AgentsConfig, StageName, PipelineRun } from './types.js';
import { STAGE_ORDER } from './types.js';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
} from './pipeline.js';
import { StubAgent } from './agent.js';
import { StubProvider } from './llm-provider.js';
import { buildContext } from './context-manager.js';
import { createSnapshot } from './snapshot.js';
import { eventBus } from './event-bus.js';
import { Logger } from './logger.js';

export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;

  constructor() {
    this.pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;
    this.agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
  }

  async run(instruction: string, autoApprove = false): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;
    const pipelineRun = createPipelineRun(runId, instruction, autoApprove);
    const logger = new Logger(runId);
    const provider = new StubProvider();

    logger.pipeline('info', 'pipeline:start', { runId, instruction });
    eventBus.emit('pipeline:start', runId);

    try {
      for (const stage of STAGE_ORDER) {
        await this.executeStage(pipelineRun, stage, provider, logger);
      }

      pipelineRun.completedAt = new Date().toISOString();
      logger.pipeline('info', 'pipeline:complete', { runId });
      eventBus.emit('pipeline:complete', runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.pipeline('error', 'pipeline:failed', { runId, error: message });
      eventBus.emit('pipeline:failed', runId, message);
      throw err;
    } finally {
      await logger.close();
    }

    return pipelineRun;
  }

  private async executeStage(
    run: PipelineRun,
    stage: StageName,
    provider: StubProvider,
    logger: Logger
  ): Promise<void> {
    const stageConfig = this.pipelineConfig.stages[stage];
    const maxRetries = stageConfig.retry_max;

    run.currentStage = stage;
    transitionStage(run, stage, 'running');
    logger.pipeline('info', 'stage:start', { stage });
    eventBus.emit('stage:start', stage, run.id);

    try {
      // Build context (artifact isolation)
      const task = { runId: run.id, stage, instruction: run.instruction };
      const context = buildContext(this.agentsConfig, task);

      // Create and execute agent
      const agent = new StubAgent(stage, provider, logger);
      await agent.execute(context);

      // Gate check
      if (shouldAutoApprove(run, stageConfig)) {
        transitionStage(run, stage, 'done');
      } else {
        // Manual gate — in Phase 1 with --auto-approve, this won't happen
        transitionStage(run, stage, 'awaiting_human');
        transitionStage(run, stage, 'approved');
        transitionStage(run, stage, 'done');
      }

      // Snapshot
      createSnapshot(stage, run.id);

      logger.pipeline('info', 'stage:complete', { stage });
      eventBus.emit('stage:complete', stage, run.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stageStatus = run.stages[stage];

      if (stageStatus.retryCount < maxRetries) {
        stageStatus.retryCount++;
        transitionStage(run, stage, 'failed');
        transitionStage(run, stage, 'idle');
        logger.pipeline('warn', 'stage:retry', { stage, retry: stageStatus.retryCount });
        return this.executeStage(run, stage, provider, logger);
      }

      // Rollback to previous stage
      const prev = getPreviousStage(stage);
      if (prev) {
        transitionStage(run, stage, 'failed');
        logger.pipeline('warn', 'stage:rollback', { from: stage, to: prev });
        eventBus.emit('stage:rollback', stage, prev, run.id);
      }

      eventBus.emit('stage:failed', stage, run.id, message);
      throw err;
    }
  }
}
