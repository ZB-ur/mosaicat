import type { PipelineRun, StageName, AgentsConfig, AgentContext } from './types.js';
import { ClarificationNeeded } from './types.js';
import type { StageOutcome } from './stage-outcome.js';
import type { RunContext } from './run-context.js';
import type { InteractionHandler } from './interaction-handler.js';
import { transitionStage, shouldAutoApprove } from './pipeline.js';
import { buildContext } from './context-manager.js';
import { createAgent } from './agent-factory.js';
import { createSnapshot } from './snapshot.js';
import { logRetry, classifyError } from './retry-log.js';

/**
 * Executes a single pipeline stage attempt and returns a StageOutcome.
 * Never recurses, never retries internally -- it executes exactly one attempt
 * and reports what happened via the discriminated union return type.
 *
 * Responsibilities:
 * - Build agent context from config + artifacts
 * - Create and run the agent
 * - Handle ClarificationNeeded (one round)
 * - Gate check (auto or manual)
 * - Snapshot creation (non-blocking)
 * - Tester verdict check for fix_loop
 *
 * NOT responsible for:
 * - Issue creation (stays in PipelineLoop/Orchestrator)
 * - Git commit of artifacts (stays in PipelineLoop/Orchestrator)
 * - Metrics tracking (stays in Orchestrator)
 * - Retry loops (caller decides based on StageOutcome)
 */
export class StageExecutor {
  constructor(
    private readonly ctx: RunContext,
    private readonly agentsConfig: AgentsConfig,
    private readonly handler: InteractionHandler,
  ) {}

  async execute(run: PipelineRun, stage: StageName): Promise<StageOutcome> {
    // 1. Skip if already done (resume scenario)
    if (run.stages[stage]?.state === 'done') {
      this.ctx.eventBus.emit('stage:skipped', stage, run.id);
      return { type: 'skipped' };
    }

    const stageConfig = this.ctx.config.stages[stage];
    const maxRetries = stageConfig?.retry_max ?? this.ctx.config.pipeline.max_retries_per_stage;

    run.currentStage = stage;
    transitionStage(run, stage, 'running');
    this.ctx.logger.pipeline('info', 'stage:start', { stage });
    this.ctx.eventBus.emit('stage:start', stage, run.id);

    // Set context on provider (duck typing, not instanceof -- per Research pitfall 6)
    const provider = this.ctx.provider as unknown as Record<string, unknown>;
    if (typeof provider.setContext === 'function') {
      (provider.setContext as (runId: string, stage: StageName) => void)(run.id, stage);
    }

    try {
      // Build context (artifact isolation)
      const agentConfig = this.agentsConfig.agents[stage];
      const task = { runId: run.id, stage, instruction: run.instruction, autonomy: agentConfig?.autonomy };
      const context = buildContext(this.agentsConfig, task, this.ctx.store, this.ctx.logger, this.ctx.devMode);

      // Execute agent with clarification handling
      await this.executeAgent(run, stage, context);

      // Gate check
      if (shouldAutoApprove(run, stageConfig!)) {
        transitionStage(run, stage, 'done');
      } else {
        transitionStage(run, stage, 'awaiting_human');
        this.ctx.eventBus.emit('stage:awaiting_human', stage, run.id);
        const gateResult = await this.handler.onManualGate(stage, run.id);

        if (gateResult.approved) {
          transitionStage(run, stage, 'approved');
          this.ctx.eventBus.emit('stage:approved', stage, run.id);
          transitionStage(run, stage, 'done');
        } else {
          transitionStage(run, stage, 'rejected');
          this.ctx.eventBus.emit('stage:rejected', stage, run.id);

          // Inject feedback for next retry (caller will re-invoke)
          if (gateResult.feedback) {
            context.inputArtifacts.set('rejection_feedback', `[source: reviewer] ${gateResult.feedback}`);
          }
          if (gateResult.retryComponents?.length) {
            context.inputArtifacts.set('retry_components', JSON.stringify(gateResult.retryComponents));
          }
          if (gateResult.comments?.length) {
            context.inputArtifacts.set('review_comments', JSON.stringify(gateResult.comments));
          }

          const stageStatus = run.stages[stage]!;
          stageStatus.retryCount++;
          transitionStage(run, stage, 'idle');

          return {
            type: 'rejected',
            feedback: gateResult.feedback,
            comments: gateResult.comments,
          };
        }
      }

      // Snapshot (non-blocking)
      try {
        createSnapshot(stage, run.id, undefined, this.ctx.store.getDir());
        this.ctx.eventBus.emit('snapshot:created', stage, run.id);
      } catch (snapErr) {
        this.ctx.logger.pipeline('warn', 'snapshot:failed', {
          stage,
          error: snapErr instanceof Error ? snapErr.message : String(snapErr),
        });
      }

      // Check for fix_loop trigger (tester stage with failing verdict)
      if (stage === 'tester') {
        const shouldFix = this.checkTesterVerdict();
        if (shouldFix) {
          return { type: 'fix_loop', stage: 'tester' };
        }
      }

      this.ctx.logger.pipeline('info', 'stage:complete', { stage });
      this.ctx.eventBus.emit('stage:complete', stage, run.id);
      return { type: 'done' };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stageStatus = run.stages[stage]!;

      if (stageStatus.retryCount < maxRetries) {
        stageStatus.retryCount++;
        logRetry({
          timestamp: new Date().toISOString(),
          runId: run.id,
          stage,
          source: 'stage-executor',
          attempt: stageStatus.retryCount,
          errorCategory: classifyError(message),
          errorMessage: message,
          resolved: false,
        });
        transitionStage(run, stage, 'failed');
        transitionStage(run, stage, 'idle');
        this.ctx.eventBus.emit('stage:retry', stage, run.id, stageStatus.retryCount);
        return { type: 'retry', reason: message, attempt: stageStatus.retryCount };
      }

      transitionStage(run, stage, 'failed');
      this.ctx.eventBus.emit('stage:failed', stage, run.id, message);
      return { type: 'failed', error: message, retriesExhausted: true };
    }
  }

  private async executeAgent(run: PipelineRun, stage: StageName, context: AgentContext): Promise<void> {
    const agentConfig = this.agentsConfig.agents[stage];
    const agent = createAgent(stage, this.ctx, agentConfig?.autonomy, this.handler);
    try {
      await agent.execute(context);
    } catch (err) {
      if (err instanceof ClarificationNeeded) {
        let answer: string;

        if (run.autoApprove) {
          // Auto-approve mode: pick the first option or use a default answer
          answer = err.options?.[0]?.label ?? 'auto-approved';
          this.ctx.logger.pipeline('info', 'clarification:auto-answered', {
            stage, question: err.question, answer,
          });
          this.ctx.eventBus.emit('clarification:answered', stage, err.question, answer, 'auto');
        } else {
          transitionStage(run, stage, 'awaiting_clarification');

          answer = await this.handler.onClarification(
            stage, err.question, run.id,
            err.options, err.allowCustom, err.context, err.impact,
          );
          this.ctx.eventBus.emit('clarification:answered', stage, err.question, answer, 'user');
        }

        context.inputArtifacts.set('clarification_answer', `[source: user] ${answer}`);

        // Only transition back to running if we left running state (non-auto-approve path)
        if (!run.autoApprove) {
          transitionStage(run, stage, 'running');
        }

        // Re-run agent with clarification answer
        await agent.execute(context);
      } else {
        throw err;
      }
    }
  }

  private checkTesterVerdict(): boolean {
    try {
      const manifest = JSON.parse(this.ctx.store.read('test-report.manifest.json'));
      return manifest?.verdict === 'fail';
    } catch {
      return false;
    }
  }
}
