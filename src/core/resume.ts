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

  // Step 2: Verify done stages have essential outputs on disk
  // Only check manifest files as completion indicators (last thing written by BaseAgent).
  // Skip directory outputs (e.g. "code/", "components/") and optional files
  // (e.g. constitution.project.md) to avoid false cascade resets.
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
        const outputs = agentConfig.outputs ?? [];

        // Essential outputs: manifest files are the definitive completion markers.
        // Fallback: first non-directory, non-manifest file (e.g. validation-report.md).
        const manifests = outputs.filter((o: string) => o.endsWith('.manifest.json'));
        const essentialOutputs = manifests.length > 0
          ? manifests
          : outputs.filter((o: string) => !o.endsWith('/'));

        const missingEssential = essentialOutputs.find((output: string) => {
          const outputPath = path.join(runDir, output);
          return !fs.existsSync(outputPath);
        });

        if (missingEssential) {
          // This stage's essential outputs are missing — reset it and all downstream
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
 * Stage → artifact outputs mapping for cleanup.
 * Each entry lists the files/directories to delete when resetting that stage.
 */
const STAGE_ARTIFACTS: Record<string, string[]> = {
  intent_consultant: ['intent-brief.json'],
  researcher: ['research.md', 'research.manifest.json'],
  product_owner: ['prd.md', 'prd.manifest.json', 'constitution.project.md'],
  ux_designer: ['ux-flows.md', 'ux-flows.manifest.json'],
  api_designer: ['api-spec.yaml', 'api-spec.manifest.json'],
  ui_designer: ['ui-plan.json', 'gallery.html', 'components.manifest.json', 'components', 'previews', 'screenshots'],
  tech_lead: ['tech-spec.md', 'tech-spec.manifest.json'],
  qa_lead: ['test-plan.md', 'test-plan.manifest.json'],
  coder: ['code-plan.json', 'code.manifest.json'],
  tester: ['test-report.md', 'test-report.manifest.json', 'test_failures'],
  security_auditor: ['security-report.md', 'security-report.manifest.json'],
  reviewer: ['review-report.md', 'review.manifest.json'],
  validator: ['validation-report.md'],
};

/**
 * Reset pipeline state from a specific stage, cleaning up artifacts on disk.
 *
 * Rules:
 * - The specified stage and all downstream stages are reset to idle
 * - Their disk artifacts are deleted
 * - Special handling for shared code/ directory:
 *   - --from qa_lead (or earlier): delete entire code/
 *   - --from coder: delete code/ except tests/ (preserve QALead's tests)
 *   - --from tester (or later): don't touch code/
 * - fixLoopRound reset to 0 when coder or tester is in the reset range
 */
export function resetFromStage(
  state: SavedPipelineState,
  fromStage: StageName,
  stageOrder: readonly StageName[],
): void {
  const fromIdx = stageOrder.indexOf(fromStage);
  if (fromIdx < 0) {
    throw new Error(`Unknown stage: ${fromStage}. Valid stages: ${stageOrder.join(', ')}`);
  }

  // Validate: fromStage must be done or idle/failed (not ahead of progress)
  const status = state.stages[fromStage];
  if (!status) {
    throw new Error(`Stage ${fromStage} not found in pipeline state`);
  }

  const runDir = path.join(ARTIFACTS_BASE, state.id);
  const stagesToReset = stageOrder.slice(fromIdx);

  // 1. Clean disk artifacts for each reset stage
  for (const stage of stagesToReset) {
    const artifacts = STAGE_ARTIFACTS[stage] ?? [];
    for (const artifact of artifacts) {
      const artifactPath = path.join(runDir, artifact);
      if (fs.existsSync(artifactPath)) {
        fs.rmSync(artifactPath, { recursive: true, force: true });
      }
    }
  }

  // 2. Handle shared code/ directory
  const coderInReset = stagesToReset.includes('coder');
  const qaLeadInReset = stagesToReset.includes('qa_lead');
  const codeDirPath = path.join(runDir, 'code');

  if (qaLeadInReset && fs.existsSync(codeDirPath)) {
    // QALead is being reset — delete entire code/ (QALead + Coder both re-run)
    fs.rmSync(codeDirPath, { recursive: true, force: true });
  } else if (coderInReset && fs.existsSync(codeDirPath)) {
    // Only Coder reset — preserve code/tests/ (QALead's output)
    for (const entry of fs.readdirSync(codeDirPath)) {
      if (entry === 'tests') continue;
      fs.rmSync(path.join(codeDirPath, entry), { recursive: true, force: true });
    }
  }

  // 3. Reset pipeline state
  for (const stage of stagesToReset) {
    state.stages[stage] = { state: 'idle', retryCount: 0 };
  }

  // 4. Reset fixLoopRound if coder/tester involved
  if (coderInReset || stagesToReset.includes('tester')) {
    state.fixLoopRound = 0;
  }
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
