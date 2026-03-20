import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import { getArtifactsDir } from '../core/artifact.js';
import type { StageName, PipelineConfig } from '../core/types.js';
import { STAGE_NAMES } from '../core/types.js';
import type { EvolutionProposal, EvolutionState, EvolutionType, LLMProposalCandidate } from './types.js';
import { LLMProposalCandidateSchema } from './types.js';
import { getCurrentPromptPath } from './prompt-versioning.js';

const STATE_DIR = '.mosaic/evolution';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const EVOLUTION_ANALYST_PROMPT = `You are an evolution analyst for an AI agent pipeline. Your job is to analyze pipeline run results and propose improvements.

You will receive:
- A validation report summarizing the pipeline run quality
- Manifest files summarizing each agent's output
- Retry counts and stage timings

Based on this data, identify:
1. **Prompt improvements**: If an agent produced low-quality output, had validation failures, or required retries, propose specific prompt modifications to address the issue.
2. **Reusable skills**: If you notice patterns that could be extracted into reusable skills (techniques, templates, analysis frameworks), propose them.

Rules:
- Only propose changes that are clearly supported by the evidence
- Each proposal must include a clear reason
- For prompt modifications, provide the complete new prompt text
- For skills, provide the skill content and metadata (name, scope, description)
- scope should be "shared" if the skill is useful across agents, "private" if specific to one agent

Respond with a JSON array of proposals:
[
  {
    "type": "prompt_modification" | "skill_creation",
    "agentStage": "researcher" | "product_owner" | "ux_designer" | "api_designer" | "ui_designer" | "validator",
    "reason": "Why this change is needed",
    "proposedContent": "The new prompt text or skill content",
    "skillMetadata": { "name": "skill-name", "scope": "shared" | "private", "description": "What this skill does" }
  }
]

If no improvements are needed, respond with an empty array: []`;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class EvolutionEngine {
  private provider: LLMProvider;
  private logger: Logger;

  constructor(provider: LLMProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
  }

  /**
   * Analyze a single stage's output for evolution proposals.
   * Called after each stage completes (stage-level evolution).
   */
  async analyzeStage(runId: string, stage: StageName): Promise<EvolutionProposal[]> {
    this.logger.pipeline('info', 'evolution:analyze-stage:start', { runId, stage });

    const state = this.loadState();
    const summary = this.buildStageSummary(stage);

    if (!summary) {
      this.logger.pipeline('info', 'evolution:analyze-stage:no-data', { runId, stage });
      return [];
    }

    return this.runAnalysis(runId, summary, state);
  }

  /**
   * Analyze the full pipeline run for evolution proposals.
   * Called after pipeline completes (pipeline-level evolution).
   */
  async analyze(runId: string): Promise<EvolutionProposal[]> {
    this.logger.pipeline('info', 'evolution:analyze:start', { runId });

    const state = this.loadState();
    const summary = this.buildPipelineSummary(runId);

    if (!summary) {
      this.logger.pipeline('info', 'evolution:analyze:no-data', { runId });
      return [];
    }

    return this.runAnalysis(runId, summary, state);
  }

  private async runAnalysis(
    runId: string,
    summary: string,
    state: EvolutionState,
  ): Promise<EvolutionProposal[]> {
    // Call LLM for analysis
    let rawContent: string;
    try {
      const response = await this.provider.call(summary, {
        systemPrompt: EVOLUTION_ANALYST_PROMPT,
      });
      rawContent = response.content;
    } catch (err) {
      this.logger.pipeline('error', 'evolution:analyze:llm-error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }

    // Parse LLM response
    const candidates = this.parseCandidates(rawContent);
    if (candidates.length === 0) {
      this.logger.pipeline('info', 'evolution:analyze:no-proposals', { runId });
      return [];
    }

    // Filter by cooldown and pending rules
    const proposals: EvolutionProposal[] = [];
    for (const candidate of candidates) {
      if (!this.canPropose(candidate.agentStage, candidate.type, state)) {
        this.logger.pipeline('info', 'evolution:analyze:filtered', {
          stage: candidate.agentStage,
          type: candidate.type,
          reason: 'cooldown or pending limit',
        });
        continue;
      }

      const proposal = this.candidateToProposal(candidate, runId, state);
      proposals.push(proposal);
      state.proposals.push(proposal);
    }

    this.saveState(state);
    this.logger.pipeline('info', 'evolution:analyze:complete', {
      runId,
      proposalCount: proposals.length,
    });

    return proposals;
  }

  canPropose(stage: StageName, type: EvolutionType, stateOverride?: EvolutionState): boolean {
    const state = stateOverride ?? this.loadState();

    // Check max-1-pending-per-agent
    const hasPending = state.proposals.some(
      (p) => p.agentStage === stage && p.status === 'pending'
    );
    if (hasPending) return false;

    // Cooldown only applies to prompt modifications
    if (type === 'prompt_modification') {
      const cooldownKey = `${stage}:prompt_modification`;
      const lastProposal = state.cooldowns[cooldownKey];
      if (lastProposal) {
        const config = this.loadEvolutionConfig();
        const cooldownMs = config.cooldown_hours * 60 * 60 * 1000;
        const elapsed = Date.now() - new Date(lastProposal).getTime();
        if (elapsed < cooldownMs) return false;
      }
    }

    return true;
  }

  loadState(): EvolutionState {
    if (!fs.existsSync(STATE_FILE)) {
      return { proposals: [], promptVersions: {}, cooldowns: {} };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }

  saveState(state: EvolutionState): void {
    ensureDir(STATE_DIR);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  private buildStageSummary(stage: StageName): string | null {
    const parts: string[] = [];
    const artifactsDir = getArtifactsDir();

    if (!fs.existsSync(artifactsDir)) return null;

    // Find manifests and artifacts for this stage
    const stageArtifactMap: Record<string, string[]> = {
      researcher: ['research.md', 'research.manifest.json'],
      product_owner: ['prd.md', 'prd.manifest.json'],
      ux_designer: ['ux-flows.md', 'ux-flows.manifest.json'],
      api_designer: ['api-spec.yaml', 'api-spec.manifest.json'],
      ui_designer: ['components.manifest.json'],
      validator: ['validation-report.md'],
    };

    const files = stageArtifactMap[stage] ?? [];
    for (const file of files) {
      const filePath = path.join(artifactsDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        parts.push(`## ${file}\n${content}`);
      }
    }

    if (parts.length === 0) return null;

    parts.unshift(`# Stage Analysis: ${stage}`);
    return parts.join('\n\n');
  }

  private buildPipelineSummary(runId: string): string | null {
    const parts: string[] = [];

    // Read validation report
    const validationPath = `${getArtifactsDir()}/validation-report.md`;
    if (fs.existsSync(validationPath)) {
      parts.push('## Validation Report\n' + fs.readFileSync(validationPath, 'utf-8'));
    }

    // Read all manifests
    const artifactsDir = getArtifactsDir();
    if (fs.existsSync(artifactsDir)) {
      const files = fs.readdirSync(artifactsDir);
      for (const file of files) {
        if (file.endsWith('.manifest.json')) {
          const content = fs.readFileSync(path.join(artifactsDir, file), 'utf-8');
          parts.push(`## Manifest: ${file}\n${content}`);
        }
      }
    }

    // Read run logs for retry counts and timings
    const logDir = `.mosaic/logs/${runId}`;
    if (fs.existsSync(logDir)) {
      const pipelineLog = path.join(logDir, 'pipeline.log');
      if (fs.existsSync(pipelineLog)) {
        const logContent = fs.readFileSync(pipelineLog, 'utf-8');
        const retries = (logContent.match(/stage:retry/g) || []).length;
        parts.push(`## Run Metadata\nRun ID: ${runId}\nRetries: ${retries}`);
      }
    }

    if (parts.length === 0) return null;

    parts.unshift(`# Pipeline Run Summary: ${runId}`);
    return parts.join('\n\n');
  }

  private parseCandidates(rawResponse: string): LLMProposalCandidate[] {
    // Extract JSON array from response (may be wrapped in markdown code blocks)
    let jsonStr = rawResponse.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      const valid: LLMProposalCandidate[] = [];
      for (const item of parsed) {
        const result = LLMProposalCandidateSchema.safeParse(item);
        if (result.success) {
          valid.push(result.data);
        }
      }
      return valid;
    } catch {
      this.logger.pipeline('warn', 'evolution:parse-error', { rawResponse: rawResponse.slice(0, 500) });
      return [];
    }
  }

  private candidateToProposal(
    candidate: LLMProposalCandidate,
    runId: string,
    state: EvolutionState
  ): EvolutionProposal {
    const id = `evo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Read current prompt for diff context
    let currentContent: string | undefined;
    if (candidate.type === 'prompt_modification') {
      try {
        const promptPath = getCurrentPromptPath(candidate.agentStage);
        currentContent = fs.readFileSync(promptPath, 'utf-8');
      } catch {
        // Prompt file may not exist
      }
    }

    // Update cooldown
    const cooldownKey = `${candidate.agentStage}:${candidate.type}`;
    state.cooldowns[cooldownKey] = now;

    return {
      id,
      type: candidate.type,
      agentStage: candidate.agentStage,
      runId,
      reason: candidate.reason,
      currentContent,
      proposedContent: candidate.proposedContent,
      status: 'pending',
      createdAt: now,
      skillMetadata: candidate.skillMetadata,
    };
  }

  private loadEvolutionConfig(): { cooldown_hours: number } {
    try {
      const config = yaml.load(
        fs.readFileSync('config/pipeline.yaml', 'utf-8')
      ) as PipelineConfig;
      return {
        cooldown_hours: config.evolution?.cooldown_hours ?? 24,
      };
    } catch {
      return { cooldown_hours: 24 };
    }
  }
}
