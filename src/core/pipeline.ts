import type { EventBus } from './event-bus.js';
import type { Logger } from './logger.js';
import type { SnapshotManager } from './snapshot.js';
import type { BaseAgent } from './agent.js';
import type {
  StageName,
  StageState,
  PipelineRun,
  PipelineConfig,
  Task,
  PipelineStatus,
} from './types.js';
import { STAGE_ORDER } from './types.js';

export class Pipeline {
  private run: PipelineRun | null = null;
  private agents: Map<StageName, BaseAgent>;
  private resolveGate: ((approved: boolean) => void) | null = null;

  constructor(
    private config: PipelineConfig,
    private eventBus: EventBus,
    private logger: Logger,
    private snapshotManager: SnapshotManager,
    agents: Map<StageName, BaseAgent>,
  ) {
    this.agents = agents;
  }

  async start(task: Task, autoApprove = false): Promise<PipelineRun> {
    const run = this.initRun(task);
    this.run = run;
    run.status = 'running';
    this.eventBus.emit('pipeline:started', run);

    try {
      for (const stage of STAGE_ORDER) {
        await this.executeStage(stage, run, autoApprove);
      }
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      this.eventBus.emit('pipeline:completed', run);
    } catch (error) {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      this.eventBus.emit('pipeline:failed', run, error as Error);
      throw error;
    }

    return run;
  }

  approve(): void {
    if (this.resolveGate) {
      this.resolveGate(true);
      this.resolveGate = null;
    }
  }

  reject(): void {
    if (this.resolveGate) {
      this.resolveGate(false);
      this.resolveGate = null;
    }
  }

  getStatus(): { pipeline: PipelineStatus; run: PipelineRun | null } {
    return {
      pipeline: this.run?.status ?? 'idle',
      run: this.run,
    };
  }

  private async executeStage(
    stage: StageName,
    run: PipelineRun,
    autoApprove: boolean,
  ): Promise<void> {
    const stageState = run.stages[stage];
    const stageConfig = this.config.stages[stage];
    const maxRetries = this.config.pipeline.max_retries_per_stage;

    while (stageState.retries < maxRetries) {
      stageState.status = 'running';
      stageState.startedAt = new Date().toISOString();
      run.currentStage = stage;
      this.eventBus.emit('stage:started', stage, run);

      try {
        const agent = this.agents.get(stage);
        if (!agent) {
          throw new Error(`No agent registered for stage: ${stage}`);
        }

        await agent.execute(run.task, stageConfig);

        // Gate check
        if (stageConfig.gate === 'manual' && !autoApprove) {
          stageState.status = 'awaiting_human';
          run.status = 'paused';
          this.eventBus.emit('stage:awaiting_human', stage, run);

          const approved = await this.waitForGate();
          if (approved) {
            this.eventBus.emit('stage:approved', stage, run);
          } else {
            this.eventBus.emit('stage:rejected', stage, run);
            stageState.status = 'rejected';
            stageState.retries++;

            // Rollback to previous stage
            const prevStageIndex = STAGE_ORDER.indexOf(stage) - 1;
            if (prevStageIndex >= 0) {
              const prevStage = STAGE_ORDER[prevStageIndex];
              this.logger.pipeline('info', 'rollback', {
                from: stage,
                to: prevStage,
                retry: stageState.retries,
              });
              // Re-run previous stage by recursive call
              run.stages[prevStage].status = 'idle';
              run.stages[prevStage].retries++;
              await this.executeStage(prevStage, run, autoApprove);
            }
            // Continue to retry current stage
            run.status = 'running';
            continue;
          }
        }

        // Stage completed
        stageState.status = 'done';
        stageState.completedAt = new Date().toISOString();
        run.status = 'running';
        this.eventBus.emit('stage:completed', stage, run);

        // Create snapshot
        this.snapshotManager.createSnapshot(stage, run);
        return;
      } catch (error) {
        stageState.retries++;
        stageState.error = (error as Error).message;
        this.eventBus.emit('stage:failed', stage, run, error as Error);

        if (stageState.retries >= maxRetries) {
          stageState.status = 'failed';
          throw new Error(
            `Stage ${stage} failed after ${maxRetries} retries: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  private waitForGate(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveGate = resolve;
    });
  }

  private initRun(task: Task): PipelineRun {
    const stages: Record<string, StageState> = {};
    for (const stage of STAGE_ORDER) {
      stages[stage] = {
        name: stage,
        status: 'idle',
        retries: 0,
      };
    }

    return {
      id: `run-${Date.now()}`,
      task,
      status: 'idle',
      currentStage: null,
      stages: stages as Record<StageName, StageState>,
      startedAt: new Date().toISOString(),
    };
  }
}
