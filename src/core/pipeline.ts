import type { StageName, StageState, StageStatus, PipelineRun, StageConfig } from './types.js';

export function createPipelineRun(
  id: string,
  instruction: string,
  autoApprove: boolean,
  stageNames: readonly StageName[],
): PipelineRun {
  const stages: Partial<Record<StageName, StageStatus>> = {};
  for (const name of stageNames) {
    stages[name] = { state: 'idle', retryCount: 0 };
  }

  return {
    id,
    instruction,
    stages,
    currentStage: null,
    autoApprove,
    createdAt: new Date().toISOString(),
  };
}

export function transitionStage(
  run: PipelineRun,
  stage: StageName,
  newState: StageState
): void {
  const status = run.stages[stage]!;
  validateTransition(status.state, newState);

  status.state = newState;
  if (newState === 'running' && !status.startedAt) {
    status.startedAt = new Date().toISOString();
  }
  if (newState === 'done') {
    status.completedAt = new Date().toISOString();
  }
}

export function shouldAutoApprove(run: PipelineRun, stageConfig: StageConfig): boolean {
  return stageConfig.gate === 'auto' || run.autoApprove;
}

/** Get ordered stage list from a PipelineRun */
export function getRunStages(run: PipelineRun): StageName[] {
  return Object.keys(run.stages) as StageName[];
}

export function getPreviousStage(run: PipelineRun, stage: StageName): StageName | null {
  const stages = getRunStages(run);
  const idx = stages.indexOf(stage);
  return idx > 0 ? stages[idx - 1] : null;
}

export function getNextStage(run: PipelineRun, stage: StageName): StageName | null {
  const stages = getRunStages(run);
  const idx = stages.indexOf(stage);
  return idx < stages.length - 1 ? stages[idx + 1] : null;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<StageState, StageState[]> = {
  idle: ['running', 'skipped'],
  running: ['awaiting_clarification', 'awaiting_human', 'done', 'failed'],
  awaiting_clarification: ['running', 'failed'],
  awaiting_human: ['approved', 'rejected', 'failed'],
  approved: ['done'],
  rejected: ['idle'],  // rollback resets to idle
  failed: ['idle', 'skipped'],  // retry resets to idle, or user skips
  done: [],
  skipped: [],         // terminal state — skipped stages don't transition
};

function validateTransition(from: StageState, to: StageState): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}
