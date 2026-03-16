import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig, AgentsConfig, StageName, PipelineRun, AgentContext } from './types.js';
import { STAGE_ORDER, ClarificationNeeded } from './types.js';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
} from './pipeline.js';
import type { LLMProvider } from './llm-provider.js';
import { createProvider } from './provider-factory.js';
import { createAgent } from './agent-factory.js';
import { buildContext } from './context-manager.js';
import { createSnapshot } from './snapshot.js';
import { eventBus } from './event-bus.js';
import { Logger } from './logger.js';
import type { InteractionHandler } from './interaction-handler.js';
import { CLIInteractionHandler } from './interaction-handler.js';

export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;
  private handler: InteractionHandler;

  constructor(handler?: InteractionHandler) {
    this.pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;
    this.agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
    this.handler = handler ?? new CLIInteractionHandler();
  }

  async run(instruction: string, autoApprove = false): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;
    const pipelineRun = createPipelineRun(runId, instruction, autoApprove);
    const logger = new Logger(runId);
    const provider = createProvider();

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
    provider: LLMProvider,
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

      // Create and execute agent (with clarification handling)
      await this.executeAgent(run, stage, provider, logger, context);

      // Gate check
      if (shouldAutoApprove(run, stageConfig)) {
        transitionStage(run, stage, 'done');
      } else {
        // Manual gate
        transitionStage(run, stage, 'awaiting_human');
        eventBus.emit('stage:awaiting_human', stage, run.id);
        logger.pipeline('info', 'stage:awaiting_human', { stage });

        const approved = await this.handler.onManualGate(stage, run.id);

        if (approved) {
          transitionStage(run, stage, 'approved');
          eventBus.emit('stage:approved', stage, run.id);
          transitionStage(run, stage, 'done');
        } else {
          transitionStage(run, stage, 'rejected');
          eventBus.emit('stage:rejected', stage, run.id);
          logger.pipeline('info', 'stage:rejected', { stage });
          // Re-run the stage after rejection
          transitionStage(run, stage, 'idle');
          return this.executeStage(run, stage, provider, logger);
        }
      }

      // Snapshot
      createSnapshot(stage, run.id);

      logger.pipeline('info', 'stage:complete', { stage });
      eventBus.emit('stage:complete', stage, run.id);
    } catch (err) {
      // ClarificationNeeded is handled inside executeAgent, not here
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

  private async executeAgent(
    run: PipelineRun,
    stage: StageName,
    provider: LLMProvider,
    logger: Logger,
    context: AgentContext
  ): Promise<void> {
    const agent = createAgent(stage, provider, logger);

    try {
      await agent.execute(context);
    } catch (err) {
      if (!(err instanceof ClarificationNeeded)) {
        throw err;
      }

      const stageConfig = this.pipelineConfig.stages[stage];
      if (!stageConfig.clarification) {
        // Stage doesn't support clarification, re-throw
        throw err;
      }

      // Handle clarification: one round
      transitionStage(run, stage, 'awaiting_clarification');
      logger.pipeline('info', 'stage:clarification', { stage, question: err.question });

      const answer = await this.handler.onClarification(stage, err.question, run.id);

      // Augment context with user answer
      context.inputArtifacts.set(
        'clarification_answer',
        `[source: user] ${answer}`
      );

      transitionStage(run, stage, 'running');

      // Re-run agent with augmented context
      const retryAgent = createAgent(stage, provider, logger);
      await retryAgent.execute(context);
    }
  }
}
