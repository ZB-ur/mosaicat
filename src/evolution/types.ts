import { z } from 'zod';
import type { StageName } from '../core/types.js';
import { STAGE_NAMES } from '../core/types.js';

// --- Evolution Types ---

export const EVOLUTION_TYPES = ['prompt_modification', 'skill_creation'] as const;
export type EvolutionType = (typeof EVOLUTION_TYPES)[number];

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const SKILL_SCOPES = ['shared', 'private'] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

// --- Skill Metadata ---

export interface SkillMetadata {
  name: string;
  scope: SkillScope;
  description: string;
}

export const SkillMetadataSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(SKILL_SCOPES),
  description: z.string().min(1),
});

// --- Evolution Proposal ---

export interface EvolutionProposal {
  id: string;
  type: EvolutionType;
  agentStage: StageName;
  runId: string;
  reason: string;
  currentContent?: string;
  proposedContent: string;
  diff?: string;
  status: ProposalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
  skillMetadata?: SkillMetadata;
}

export const EvolutionProposalSchema = z.object({
  id: z.string().min(1),
  type: z.enum(EVOLUTION_TYPES),
  agentStage: z.enum(STAGE_NAMES),
  runId: z.string().min(1),
  reason: z.string().min(1),
  currentContent: z.string().optional(),
  proposedContent: z.string().min(1),
  diff: z.string().optional(),
  status: z.enum(PROPOSAL_STATUSES),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
  skillMetadata: SkillMetadataSchema.optional(),
});

// --- Prompt Version ---

export interface PromptVersion {
  version: number;
  timestamp: string;
  filePath: string;
  proposalId: string;
  agentStage: StageName;
}

export const PromptVersionSchema = z.object({
  version: z.number().int().min(1),
  timestamp: z.string(),
  filePath: z.string(),
  proposalId: z.string(),
  agentStage: z.enum(STAGE_NAMES),
});

// --- Evolution State ---

export interface EvolutionState {
  proposals: EvolutionProposal[];
  promptVersions: Record<string, PromptVersion[]>;
  cooldowns: Record<string, string>;
}

export const EvolutionStateSchema = z.object({
  proposals: z.array(EvolutionProposalSchema),
  promptVersions: z.record(z.string(), z.array(PromptVersionSchema)),
  cooldowns: z.record(z.string(), z.string()),
});

// --- Skill Info (for skills.json index) ---

export interface SkillInfo {
  name: string;
  scope: SkillScope;
  description: string;
  agentStage: StageName;
  filePath: string;
  proposalId: string;
  createdAt: string;
}

export const SkillInfoSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(SKILL_SCOPES),
  description: z.string().min(1),
  agentStage: z.enum(STAGE_NAMES),
  filePath: z.string(),
  proposalId: z.string(),
  createdAt: z.string(),
});

// --- LLM Proposal Candidate (raw response from evolution analyst) ---

export interface LLMProposalCandidate {
  type: EvolutionType;
  agentStage: StageName;
  reason: string;
  proposedContent: string;
  skillMetadata?: SkillMetadata;
}

export const LLMProposalCandidateSchema = z.object({
  type: z.enum(EVOLUTION_TYPES),
  agentStage: z.enum(STAGE_NAMES),
  reason: z.string().min(1),
  proposedContent: z.string().min(1),
  skillMetadata: SkillMetadataSchema.optional(),
});
