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
import { GitHubInteractionHandler } from './github-interaction-handler.js';
import { CLIInteractionHandler } from './interaction-handler.js';
import type { GitPlatformAdapter } from '../adapters/types.js';
import { buildIssueBody } from './security.js';
import type { StageIssueParams } from './security.js';
import { GitPublisher } from './git-publisher.js';
import { generatePRBody } from './pr-body-generator.js';
import type { LLMUsage } from './llm-provider.js';

interface StageMetrics {
  startTime: number;
  usage?: LLMUsage;
  hadClarification: boolean;
  wasRejected: boolean;
  commitSha?: string;
}

export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;
  private handler: InteractionHandler;
  private adapter?: GitPlatformAdapter;
  private publisher?: GitPublisher;
  private stageIssues = new Map<string, number>();
  private stageMetrics = new Map<StageName, StageMetrics>();

  constructor(handler?: InteractionHandler, adapter?: GitPlatformAdapter) {
    this.pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;
    this.agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
    this.handler = handler ?? new CLIInteractionHandler();
    this.adapter = adapter;
  }

  async run(instruction: string, autoApprove = false): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;
    const pipelineRun = createPipelineRun(runId, instruction, autoApprove);
    const logger = new Logger(runId);
    const provider = createProvider();

    logger.pipeline('info', 'pipeline:start', { runId, instruction });
    eventBus.emit('pipeline:start', runId);

    // Initialize GitPublisher for GitHub mode
    if (this.adapter) {
      this.publisher = new GitPublisher(this.adapter);
      try {
        await this.publisher.init(runId, instruction.slice(0, 80));
      } catch (err) {
        // Git publisher init failure is non-fatal — continue without it
        logger.pipeline('warn', 'git-publisher:init-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.publisher = undefined;
      }
    }

    try {
      for (const stage of STAGE_ORDER) {
        await this.executeStage(pipelineRun, stage, provider, logger);
      }

      // Post-run evolution analysis
      if (this.pipelineConfig.evolution?.enabled) {
        await this.runEvolution(runId, provider, logger);
      }

      pipelineRun.completedAt = new Date().toISOString();
      await this.createSummaryIssue(runId);

      // Publish PR (mark ready for review)
      if (this.publisher) {
        try {
          // Generate rich PR body with screenshots, preview links, token stats
          const adapterAny = this.adapter as { getOwner?: () => string; getRepo?: () => string };
          const owner = adapterAny.getOwner?.() ?? '';
          const repo = adapterAny.getRepo?.() ?? '';
          const branch = this.publisher.getBranch() ?? '';
          const prBody = (owner && repo && branch)
            ? generatePRBody({ runId, owner, repo, branch })
            : `## Pipeline Complete\n\nRun: ${runId}`;
          await this.publisher.publish(prBody);
        } catch (err) {
          logger.pipeline('warn', 'git-publisher:publish-failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

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

    // Initialize metrics for this stage (only on first entry, not retries)
    if (!this.stageMetrics.has(stage)) {
      this.stageMetrics.set(stage, {
        startTime: Date.now(),
        hadClarification: false,
        wasRejected: false,
      });
    }

    // Listen for usage events for this stage
    const usageHandler = (s: StageName, usage: LLMUsage) => {
      if (s === stage) {
        const metrics = this.stageMetrics.get(stage);
        if (metrics) metrics.usage = usage;
      }
    };
    eventBus.on('agent:usage', usageHandler);

    try {
      // Build context (artifact isolation)
      const task = { runId: run.id, stage, instruction: run.instruction };
      const context = buildContext(this.agentsConfig, task);

      // Create and execute agent (with clarification handling)
      await this.executeAgent(run, stage, provider, logger, context);

      // Commit stage artifacts before gate check (so reviewers can see them)
      await this.commitStageArtifacts(stage, run.id, logger);

      // Record commit SHA
      const metrics = this.stageMetrics.get(stage);
      if (metrics && this.publisher) {
        metrics.commitSha = this.publisher.getLastCommitSha() ?? undefined;
      }

      // Gate check
      if (shouldAutoApprove(run, stageConfig)) {
        transitionStage(run, stage, 'done');
      } else {
        // Manual gate
        transitionStage(run, stage, 'awaiting_human');
        eventBus.emit('stage:awaiting_human', stage, run.id);
        logger.pipeline('info', 'stage:awaiting_human', { stage });

        const gateResult = await this.handler.onManualGate(stage, run.id);

        if (gateResult.approved) {
          transitionStage(run, stage, 'approved');
          eventBus.emit('stage:approved', stage, run.id);
          transitionStage(run, stage, 'done');
        } else {
          // Track rejection in metrics
          const rejMetrics = this.stageMetrics.get(stage);
          if (rejMetrics) rejMetrics.wasRejected = true;

          transitionStage(run, stage, 'rejected');
          eventBus.emit('stage:rejected', stage, run.id);
          logger.pipeline('info', 'stage:rejected', {
            stage,
            feedback: gateResult.feedback,
            retryComponents: gateResult.retryComponents,
          });

          // Inject feedback into context for retry
          if (gateResult.feedback) {
            context.inputArtifacts.set(
              'rejection_feedback',
              `[source: reviewer] ${gateResult.feedback}`
            );
          }
          if (gateResult.retryComponents && gateResult.retryComponents.length > 0) {
            context.inputArtifacts.set(
              'retry_components',
              JSON.stringify(gateResult.retryComponents)
            );
          }
          if (gateResult.comments && gateResult.comments.length > 0) {
            context.inputArtifacts.set(
              'review_comments',
              JSON.stringify(gateResult.comments)
            );
          }

          // Re-run the stage after rejection
          transitionStage(run, stage, 'idle');
          return this.executeStage(run, stage, provider, logger);
        }
      }

      // Snapshot (include issue numbers in metadata)
      const issueNumbers = Object.fromEntries(this.stageIssues);
      createSnapshot(stage, run.id, issueNumbers);
      eventBus.emit('snapshot:created', stage, run.id);

      // Create informational Issue on stage complete
      eventBus.off('agent:usage', usageHandler);
      await this.createStageIssue(stage, run);

      logger.pipeline('info', 'stage:complete', { stage });
      eventBus.emit('stage:complete', stage, run.id);
    } catch (err) {
      eventBus.off('agent:usage', usageHandler);
      // ClarificationNeeded is handled inside executeAgent, not here
      const message = err instanceof Error ? err.message : String(err);
      const stageStatus = run.stages[stage];

      if (stageStatus.retryCount < maxRetries) {
        stageStatus.retryCount++;
        transitionStage(run, stage, 'failed');
        transitionStage(run, stage, 'idle');
        logger.pipeline('warn', 'stage:retry', { stage, retry: stageStatus.retryCount });
        eventBus.emit('stage:retry', stage, run.id, stageStatus.retryCount);
        return this.executeStage(run, stage, provider, logger);
      }

      // Rollback to previous stage
      const prev = getPreviousStage(stage);
      if (prev) {
        transitionStage(run, stage, 'failed');
        logger.pipeline('warn', 'stage:rollback', { from: stage, to: prev });
        eventBus.emit('stage:rollback', stage, prev, run.id);
        await this.closeRolledBackIssues(stage, run.id);
      }

      eventBus.emit('stage:failed', stage, run.id, message);
      throw err;
    }
  }

  private async commitStageArtifacts(stage: StageName, runId: string, logger: Logger): Promise<void> {
    if (!this.publisher) return;
    try {
      const agentConfig = this.agentsConfig.agents[stage];
      const files = (agentConfig.outputs ?? []).map((o: string) => `.mosaic/artifacts/${o}`);
      const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
      await this.publisher.commitStage(stage, files, issueNumber);

      // Notify handler about PR (created lazily after first commit)
      const pr = this.publisher.getPR();
      if (pr && this.handler instanceof GitHubInteractionHandler) {
        this.handler.setPR(pr.number);
      }
    } catch (err) {
      logger.pipeline('warn', 'git-publisher:commit-failed', {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
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
      const clMetrics = this.stageMetrics.get(stage);
      if (clMetrics) clMetrics.hadClarification = true;

      transitionStage(run, stage, 'awaiting_clarification');
      logger.pipeline('info', 'stage:clarification', { stage, question: err.question });

      const answer = await this.handler.onClarification(
        stage, err.question, run.id, err.options, err.allowCustom
      );

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

  private async createStageIssue(stage: StageName, run: PipelineRun): Promise<void> {
    if (!this.adapter) return;

    const agentConfig = this.agentsConfig.agents[stage];
    const metrics = this.stageMetrics.get(stage);

    const params: StageIssueParams = {
      agentId: stage,
      agentName: agentConfig.name,
      taskRef: run.id,
      inputs: agentConfig.inputs ?? [],
      outputs: agentConfig.outputs ?? [],
      durationMs: metrics ? Date.now() - metrics.startTime : undefined,
      usage: metrics?.usage,
      retryCount: run.stages[stage].retryCount,
      hadClarification: metrics?.hadClarification,
      wasRejected: metrics?.wasRejected,
      commitSha: metrics?.commitSha,
    };

    const issue = await this.adapter.createIssue({
      title: `[${stage}] ${agentConfig.name} completed: ${run.id}`,
      body: buildIssueBody(params),
      labels: [`agent:${stage}`, 'status:completed'],
    });

    this.stageIssues.set(`${run.id}:${stage}`, issue.number);
    eventBus.emit('issue:created', issue.number, stage, run.id);
  }

  private async closeRolledBackIssues(stage: StageName, runId: string): Promise<void> {
    if (!this.adapter) return;

    const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
    if (!issueNumber) return;

    await this.adapter.addLabels(issueNumber, ['status:rolled-back']);
    await this.adapter.closeIssue(issueNumber);
    eventBus.emit('issue:closed', issueNumber, stage, runId);
  }

  private async createSummaryIssue(runId: string): Promise<void> {
    if (!this.adapter) return;

    const stageLinks = Array.from(this.stageIssues.entries())
      .filter(([key]) => key.startsWith(runId))
      .map(([key, num]) => {
        const stage = key.split(':')[1];
        return `- **${stage}**: #${num}`;
      })
      .join('\n');

    await this.adapter.createIssue({
      title: `[pipeline] summary: ${runId}`,
      body: `## Pipeline Summary\n\n**Run:** ${runId}\n\n### Stage Issues\n${stageLinks}\n\n---\n_Generated by Mosaicat pipeline_`,
      labels: ['pipeline:summary'],
    });
  }

  enableEvolution(): void {
    if (!this.pipelineConfig.evolution) {
      this.pipelineConfig.evolution = { enabled: true, cooldown_hours: 24 };
    } else {
      this.pipelineConfig.evolution.enabled = true;
    }
  }

  private async runEvolution(
    runId: string,
    provider: LLMProvider,
    logger: Logger
  ): Promise<void> {
    try {
      eventBus.emit('evolution:analyzing', runId);
      logger.pipeline('info', 'evolution:start', { runId });

      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');

      const engine = new EvolutionEngine(provider, logger);
      const proposals = await engine.analyze(runId);

      if (proposals.length > 0) {
        const handler = new ProposalHandler(this.handler, provider, logger);
        await handler.processProposals(proposals);
      }

      eventBus.emit('evolution:complete', runId, proposals.length);
      logger.pipeline('info', 'evolution:complete', { runId, proposalCount: proposals.length });
    } catch (err) {
      logger.pipeline('error', 'evolution:error', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Evolution errors don't fail the pipeline
    }
  }

  getStageIssues(): Map<string, number> {
    return new Map(this.stageIssues);
  }
}
