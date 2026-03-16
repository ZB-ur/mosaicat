import type { StageName, PipelineRun } from './types.js';
import { Orchestrator } from './orchestrator.js';
import { DeferredInteractionHandler } from './interaction-handler.js';

export type RunState =
  | 'running'
  | 'awaiting_human'
  | 'awaiting_clarification'
  | 'completed'
  | 'failed';

export interface RunStatus {
  id: string;
  instruction: string;
  currentStage: StageName | null;
  state: RunState;
  stages: PipelineRun['stages'];
  clarificationQuestion?: string;
  completedAt?: string;
  error?: string;
}

interface ManagedRun {
  id: string;
  instruction: string;
  handler: DeferredInteractionHandler;
  orchestratorRunId?: string;
  pipelineRun?: PipelineRun;
  promise: Promise<PipelineRun>;
  state: RunState;
  clarificationQuestion?: string;
  error?: string;
}

export class RunManager {
  private runs = new Map<string, ManagedRun>();

  async startRun(instruction: string, autoApprove = false): Promise<string> {
    const id = `managed-${Date.now()}`;
    const handler = new DeferredInteractionHandler();

    // Wrap handler to track state + capture orchestrator's internal runId
    const wrappedHandler = this.createTrackedHandler(handler, id);

    const orchestrator = new Orchestrator(wrappedHandler);

    const managedRun: ManagedRun = {
      id,
      instruction,
      handler,
      state: 'running',
      promise: null!,
    };

    managedRun.promise = orchestrator
      .run(instruction, autoApprove)
      .then((result) => {
        managedRun.pipelineRun = result;
        managedRun.state = 'completed';
        return result;
      })
      .catch((err) => {
        managedRun.state = 'failed';
        managedRun.error = err instanceof Error ? err.message : String(err);
        throw err;
      });

    this.runs.set(id, managedRun);
    return id;
  }

  getStatus(runId: string): RunStatus | undefined {
    const managed = this.runs.get(runId);
    if (!managed) return undefined;

    return {
      id: managed.id,
      instruction: managed.instruction,
      currentStage: managed.pipelineRun?.currentStage ?? null,
      state: managed.state,
      stages: managed.pipelineRun?.stages ?? ({} as PipelineRun['stages']),
      clarificationQuestion: managed.clarificationQuestion,
      completedAt: managed.pipelineRun?.completedAt,
      error: managed.error,
    };
  }

  approve(runId: string): void {
    const managed = this.runs.get(runId);
    if (!managed) throw new Error(`Run ${runId} not found`);
    if (managed.state !== 'awaiting_human') {
      throw new Error(`Run ${runId} is not awaiting approval (state: ${managed.state})`);
    }
    const orchestratorId = managed.orchestratorRunId;
    if (orchestratorId) {
      managed.handler.approve(orchestratorId);
    }
    managed.state = 'running';
  }

  reject(runId: string): void {
    const managed = this.runs.get(runId);
    if (!managed) throw new Error(`Run ${runId} not found`);
    if (managed.state !== 'awaiting_human') {
      throw new Error(`Run ${runId} is not awaiting approval (state: ${managed.state})`);
    }
    const orchestratorId = managed.orchestratorRunId;
    if (orchestratorId) {
      managed.handler.reject(orchestratorId);
    }
    managed.state = 'running';
  }

  answerClarification(runId: string, answer: string): void {
    const managed = this.runs.get(runId);
    if (!managed) throw new Error(`Run ${runId} not found`);
    if (managed.state !== 'awaiting_clarification') {
      throw new Error(`Run ${runId} is not awaiting clarification (state: ${managed.state})`);
    }
    const orchestratorId = managed.orchestratorRunId;
    if (orchestratorId) {
      managed.handler.answerClarification(orchestratorId, answer);
    }
    managed.clarificationQuestion = undefined;
    managed.state = 'running';
  }

  listRuns(): RunStatus[] {
    return Array.from(this.runs.values()).map((m) => ({
      id: m.id,
      instruction: m.instruction,
      currentStage: m.pipelineRun?.currentStage ?? null,
      state: m.state,
      stages: m.pipelineRun?.stages ?? ({} as PipelineRun['stages']),
      clarificationQuestion: m.clarificationQuestion,
      completedAt: m.pipelineRun?.completedAt,
      error: m.error,
    }));
  }

  /**
   * Wait for a run to complete. Useful for testing.
   */
  async waitForRun(runId: string): Promise<PipelineRun> {
    const managed = this.runs.get(runId);
    if (!managed) throw new Error(`Run ${runId} not found`);
    return managed.promise;
  }

  private createTrackedHandler(
    inner: DeferredInteractionHandler,
    managedRunId: string
  ): DeferredInteractionHandler {
    const managed = () => this.runs.get(managedRunId);

    // Create a wrapper that delegates to inner but tracks state
    const tracked = Object.create(inner) as DeferredInteractionHandler;

    tracked.onManualGate = async (stage: StageName, runId: string) => {
      const m = managed();
      if (m) {
        m.orchestratorRunId = runId;
        m.state = 'awaiting_human';
      }
      return inner.onManualGate(stage, runId);
    };

    tracked.onClarification = async (stage: StageName, question: string, runId: string) => {
      const m = managed();
      if (m) {
        m.orchestratorRunId = runId;
        m.state = 'awaiting_clarification';
        m.clarificationQuestion = question;
      }
      return inner.onClarification(stage, question, runId);
    };

    return tracked;
  }
}
