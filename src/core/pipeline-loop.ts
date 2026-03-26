import type { PipelineRun, StageName } from './types.js';
import type { RunContext } from './run-context.js';
import type { StageExecutor } from './stage-executor.js';
import type { FixLoopRunner } from './fix-loop-runner.js';

export interface PipelineLoopCallbacks {
  savePipelineState: (run: PipelineRun, fixLoopRound?: number) => void;
  onStageExhausted?: (stage: StageName, retryCount: number, error: string) => Promise<'retry' | 'skip' | 'abort'>;
}

/**
 * Iterative while-loop pipeline orchestrator.
 * Replaces recursive executeStage() calls with a flat loop
 * that interprets StageOutcome discriminated unions.
 *
 * Key invariants:
 * - Uses while loop, never recursion
 * - Fix loop is delegated entirely to FixLoopRunner (no index manipulation)
 * - Checks abort signal before each stage
 * - Saves state after every outcome
 */
export class PipelineLoop {
  constructor(
    private executor: StageExecutor,
    private fixRunner: FixLoopRunner,
    private ctx: RunContext,
    private callbacks: PipelineLoopCallbacks,
  ) {}

  async run(
    pipelineRun: PipelineRun,
    stages: readonly StageName[],
  ): Promise<void> {
    this.ctx.eventBus.emit('pipeline:start', pipelineRun.id, stages);

    let i = 0;
    while (i < stages.length) {
      // Check for shutdown signal before each stage
      if (this.ctx.signal.aborted) {
        this.ctx.logger.pipeline('info', 'pipeline:aborted', { stoppedAt: stages[i] });
        this.callbacks.savePipelineState(pipelineRun);
        return;
      }

      const stage = stages[i];
      const outcome = await this.executor.execute(pipelineRun, stage);

      switch (outcome.type) {
        case 'done':
        case 'skipped':
          this.callbacks.savePipelineState(pipelineRun);
          i++;
          break;

        case 'retry':
        case 'rejected':
          // Stay on same stage -- StageExecutor already incremented retryCount
          this.callbacks.savePipelineState(pipelineRun);
          break;

        case 'fix_loop':
          await this.fixRunner.run(
            pipelineRun,
            (fixRound) => this.callbacks.savePipelineState(pipelineRun, fixRound),
          );
          this.callbacks.savePipelineState(pipelineRun);
          i++; // Advance past tester after fix loop
          break;

        case 'failed':
          if (outcome.retriesExhausted) {
            const decision = await this.handleExhaustedRetries(
              pipelineRun, stage, outcome.error,
            );
            if (decision === 'retry') {
              // Reset retry count and try again
              const stageStatus = pipelineRun.stages[stage]!;
              stageStatus.retryCount = 0;
              stageStatus.state = 'idle';
              break; // Stay on same stage
            }
            if (decision === 'skip') {
              const stageStatus = pipelineRun.stages[stage]!;
              stageStatus.state = 'skipped';
              this.callbacks.savePipelineState(pipelineRun);
              i++;
              break;
            }
            // abort
            this.ctx.eventBus.emit('pipeline:failed', pipelineRun.id, outcome.error);
            this.callbacks.savePipelineState(pipelineRun);
            throw new Error(`Pipeline aborted at stage ${stage}: ${outcome.error}`);
          }
          break;
      }
    }

    pipelineRun.completedAt = new Date().toISOString();
    this.ctx.eventBus.emit('pipeline:complete', pipelineRun.id);
    this.callbacks.savePipelineState(pipelineRun);
  }

  private async handleExhaustedRetries(
    run: PipelineRun,
    stage: StageName,
    error: string,
  ): Promise<'retry' | 'skip' | 'abort'> {
    if (run.autoApprove || !this.callbacks.onStageExhausted) {
      return 'abort'; // Auto-approve mode: no user to ask
    }
    const stageStatus = run.stages[stage]!;
    return this.callbacks.onStageExhausted(stage, stageStatus.retryCount, error);
  }
}
