import { z } from 'zod';

// --- Stage Names ---

export const STAGE_NAMES = [
  'intent_consultant',
  'researcher',
  'product_owner',
  'ux_designer',
  'api_designer',
  'ui_designer',
  'tech_lead',
  'coder',
  'reviewer',
  'validator',
  // M4 预留
  'qa_lead',
  'tester',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

/** Default design-only pipeline order. Phase 4 will replace with profile-based stage lists. */
export const STAGE_ORDER: readonly StageName[] = [
  'researcher',
  'product_owner',
  'ux_designer',
  'api_designer',
  'ui_designer',
  'validator',
];

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
  'skipped',
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
  stages: Partial<Record<StageName, StageStatus>>;
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

export type PipelineProfile = 'design-only' | 'full' | 'frontend-only';

export interface PipelineConfig {
  stages: Partial<Record<StageName, StageConfig>>;
  profiles?: Record<PipelineProfile, StageName[]>;
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

export interface AgentAutonomyConfig {
  allowed_tools?: string[];
  writable_paths?: string[];
  max_turns?: number;
  max_budget_usd?: number;
}

export interface AgentOutputConfig {
  name: string;
  prompt_file: string;
  inputs: string[];
  outputs: string[];
  autonomy?: AgentAutonomyConfig;
}

export interface AgentsConfig {
  agents: Partial<Record<StageName, AgentOutputConfig>>;
}

// --- Task & Agent Context ---

export interface Task {
  runId: string;
  stage: StageName;
  instruction: string;
  autonomy?: AgentAutonomyConfig;
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

// --- Gate Result (approval/rejection with feedback) ---

export interface ReviewComment {
  file: string;       // e.g. "components/LoginForm.tsx"
  line?: number;
  body: string;       // e.g. "配色改成 #3B82F6"
  context?: string;   // diff_hunk code context
}

export interface GateResult {
  approved: boolean;
  feedback?: string;              // overall feedback (review body)
  comments?: ReviewComment[];     // line-level comments
  retryComponents?: string[];     // component names to rebuild (inferred from comments)
}

// --- Intent Brief (output of Intent Consultant) ---

export interface IntentBrief {
  problem: string;
  target_users: string;
  core_scenarios: string[];
  mvp_boundary: string;
  constraints: string[];
  domain_specifics: string[];
  recommended_profile: 'design-only' | 'full' | 'frontend-only';
  profile_reason: string;
}

export const IntentBriefSchema = z.object({
  problem: z.string().min(1),
  target_users: z.string().min(1),
  core_scenarios: z.array(z.string()),
  mvp_boundary: z.string().min(1),
  constraints: z.array(z.string()),
  domain_specifics: z.array(z.string()),
  recommended_profile: z.enum(['design-only', 'full', 'frontend-only']),
  profile_reason: z.string().min(1),
});

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
