import fs from 'node:fs';
import path from 'node:path';
import type { StageName, StageStatus, AgentsConfig, PipelineProfile } from './types.js';

const ARTIFACTS_BASE = '.mosaic/artifacts';

export interface SavedPipelineState {
  id: string;
  instruction: string;
  stages: Partial<Record<StageName, StageStatus>>;
  profile: string;
  autoApprove: boolean;
  createdAt: string;
  fixLoopRound?: number;
}

/**
 * Load saved pipeline state from a run's pipeline-state.json.
 * Throws if the file doesn't exist or is malformed.
 */
export function loadResumeState(runId: string): SavedPipelineState {
  const statePath = path.join(ARTIFACTS_BASE, runId, 'pipeline-state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`No pipeline state found for run ${runId}. File missing: ${statePath}`);
  }

  const raw = fs.readFileSync(statePath, 'utf-8');
  const state = JSON.parse(raw) as SavedPipelineState;

  if (!state.id || !state.instruction || !state.stages) {
    throw new Error(`Malformed pipeline state for run ${runId}`);
  }

  return state;
}

/**
 * Validate and clean up resume state:
 * 1. Reset 'running' / 'awaiting_*' states to 'idle' (crash recovery)
 * 2. For each 'done' stage, verify outputs exist on disk — cascade-reset if missing
 * 3. Return cleaned state
 */
export function validateResumeState(
  state: SavedPipelineState,
  agentsConfig: AgentsConfig,
): SavedPipelineState {
  const runDir = path.join(ARTIFACTS_BASE, state.id);

  // Step 1: Reset intermediate states to idle
  for (const [stage, status] of Object.entries(state.stages)) {
    if (!status) continue;
    if (['running', 'awaiting_clarification', 'awaiting_human', 'approved'].includes(status.state)) {
      status.state = 'idle';
      status.retryCount = 0;
    }
  }

  // Step 2: Verify done stages have outputs on disk
  const stageOrder = Object.keys(state.stages) as StageName[];
  let cascadeReset = false;

  for (const stage of stageOrder) {
    const status = state.stages[stage];
    if (!status) continue;

    if (cascadeReset) {
      // Reset all downstream stages
      status.state = 'idle';
      status.retryCount = 0;
      continue;
    }

    if (status.state === 'done') {
      const agentConfig = agentsConfig.agents[stage];
      if (agentConfig) {
        const missingOutput = (agentConfig.outputs ?? []).find((output: string) => {
          const outputPath = path.join(runDir, output);
          return !fs.existsSync(outputPath);
        });

        if (missingOutput) {
          // This stage's outputs are incomplete — reset it and all downstream
          status.state = 'idle';
          status.retryCount = 0;
          cascadeReset = true;
        }
      }
    }
  }

  return state;
}

/**
 * Find the most recent run that has a pipeline-state.json.
 * Returns the run ID or null.
 */
export function findResumableRun(): string | null {
  if (!fs.existsSync(ARTIFACTS_BASE)) return null;

  const entries = fs.readdirSync(ARTIFACTS_BASE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      mtime: fs.statSync(path.join(ARTIFACTS_BASE, e.name)).mtime.getTime(),
      hasState: fs.existsSync(path.join(ARTIFACTS_BASE, e.name, 'pipeline-state.json')),
    }))
    .filter(e => e.hasState)
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? entries[0].name : null;
}
