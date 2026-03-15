import { z } from 'zod';

// --- Stage & Pipeline Enums ---

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

export type StageStatus =
  | 'idle'
  | 'running'
  | 'awaiting_clarification'
  | 'awaiting_human'
  | 'approved'
  | 'rejected'
  | 'done'
  | 'failed';

export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export type GateType = 'auto' | 'manual';

// --- Configuration ---

export interface StageConfig {
  clarification: boolean;
  gate: GateType;
}

export interface PipelineConfig {
  stages: Record<StageName, StageConfig>;
  pipeline: {
    max_retries_per_stage: number;
    snapshot: string;
  };
}

export interface AgentConfig {
  input: string[];
  output: string[];
  prompt: string;
}

export interface AgentsConfig {
  agents: Record<StageName, AgentConfig>;
}

// --- Task & Artifact ---

export interface Task {
  id: string;
  instruction: string;
  createdAt: string;
}

export interface ArtifactRef {
  name: string;
  path: string;
  content?: string;
}

export interface AgentContext {
  systemPrompt: string;
  task: Task;
  inputArtifacts: ArtifactRef[];
  stageConfig: StageConfig;
  agentConfig: AgentConfig;
}

// --- LLM Provider ---

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<string>;
}

// --- Pipeline Run ---

export interface StageState {
  name: StageName;
  status: StageStatus;
  retries: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  task: Task;
  status: PipelineStatus;
  currentStage: StageName | null;
  stages: Record<StageName, StageState>;
  startedAt: string;
  completedAt?: string;
}

// --- Events ---

export interface PipelineEvents {
  'pipeline:started': (run: PipelineRun) => void;
  'pipeline:completed': (run: PipelineRun) => void;
  'pipeline:failed': (run: PipelineRun, error: Error) => void;
  'stage:started': (stage: StageName, run: PipelineRun) => void;
  'stage:completed': (stage: StageName, run: PipelineRun) => void;
  'stage:failed': (stage: StageName, run: PipelineRun, error: Error) => void;
  'stage:awaiting_clarification': (stage: StageName, questions: string[]) => void;
  'stage:awaiting_human': (stage: StageName, run: PipelineRun) => void;
  'stage:approved': (stage: StageName, run: PipelineRun) => void;
  'stage:rejected': (stage: StageName, run: PipelineRun) => void;
  'agent:llm_call': (stage: StageName, duration: number) => void;
  'agent:artifact_produced': (stage: StageName, artifact: string) => void;
}

// --- Zod Schemas for Config Validation ---

export const StageConfigSchema = z.object({
  clarification: z.boolean(),
  gate: z.enum(['auto', 'manual']),
});

export const PipelineConfigSchema = z.object({
  stages: z.record(z.enum(STAGE_NAMES as unknown as [string, ...string[]]), StageConfigSchema),
  pipeline: z.object({
    max_retries_per_stage: z.number().int().positive(),
    snapshot: z.string(),
  }),
});

export const AgentConfigSchema = z.object({
  input: z.array(z.string()),
  output: z.array(z.string()),
  prompt: z.string(),
});

export const AgentsConfigSchema = z.object({
  agents: z.record(z.enum(STAGE_NAMES as unknown as [string, ...string[]]), AgentConfigSchema),
});
