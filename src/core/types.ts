import { z } from 'zod';

// --- Stage Names ---

export const STAGE_NAMES = [
  'researcher',
  'product_owner',
  'ux_designer',
  'api_designer',
  'ui_designer',
  'validator',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const STAGE_ORDER: readonly StageName[] = STAGE_NAMES;

// --- Stage States ---

export const STAGE_STATES = [
  'idle',
  'running',
  'awaiting_clarification',
  'awaiting_human',
  'approved',
  'rejected',
  'failed',
  'done',
] as const;

export type StageState = (typeof STAGE_STATES)[number];

// --- Pipeline Run ---

export interface StageStatus {
  state: StageState;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  instruction: string;
  stages: Record<StageName, StageStatus>;
  currentStage: StageName | null;
  autoApprove: boolean;
  createdAt: string;
  completedAt?: string;
}

// --- Config Types ---

export type GateType = 'auto' | 'manual';

export interface StageConfig {
  clarification: boolean;
  gate: GateType;
  retry_max: number;
}

export interface GitHubConfig {
  enabled: boolean;
  poll_interval_ms: number;
  poll_timeout_ms: number;
  approve_keywords: string[];
  reject_keywords: string[];
}

export interface EvolutionConfig {
  enabled: boolean;
  cooldown_hours: number;
}

export interface PipelineConfig {
  stages: Record<StageName, StageConfig>;
  pipeline: {
    max_retries_per_stage: number;
    snapshot: string;
  };
  security: {
    initiator: string;
    reject_policy: string;
  };
  github: GitHubConfig;
  evolution?: EvolutionConfig;
}

export interface AgentOutputConfig {
  name: string;
  prompt_file: string;
  inputs: string[];
  outputs: string[];
}

export interface AgentsConfig {
  agents: Record<StageName, AgentOutputConfig>;
}

// --- Task & Agent Context ---

export interface Task {
  runId: string;
  stage: StageName;
  instruction: string;
}

export interface AgentContext {
  systemPrompt: string;
  task: Task;
  inputArtifacts: Map<string, string>;
}

// --- Clarification Signal ---

export interface ClarificationOption {
  label: string;
  description?: string;
}

export class ClarificationNeeded extends Error {
  readonly question: string;
  readonly options?: ClarificationOption[];
  readonly allowCustom?: boolean;

  constructor(question: string, options?: ClarificationOption[], allowCustom?: boolean) {
    super(`Clarification needed: ${question}`);
    this.name = 'ClarificationNeeded';
    this.question = question;
    this.options = options;
    this.allowCustom = allowCustom;
  }
}

// --- Zod Schemas for runtime validation ---

export const StageStatusSchema = z.object({
  state: z.enum(STAGE_STATES),
  retryCount: z.number().int().min(0),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

export const PipelineRunSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  stages: z.record(z.enum(STAGE_NAMES), StageStatusSchema),
  currentStage: z.enum(STAGE_NAMES).nullable(),
  autoApprove: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
