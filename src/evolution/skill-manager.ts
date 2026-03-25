import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from '../core/types.js';
import type { EvolutionProposal, SkillInfo, SkillScope } from './types.js';

const SKILLS_DIR = '.mosaic/evolution/skills';
const BUILTIN_DIR = path.join('config', 'skills', 'builtin');
const SKILLS_INDEX = path.join(SKILLS_DIR, 'skills.json');

// Artifact names that are stage-specific (used for scope classification)
const STAGE_SPECIFIC_ARTIFACTS: Record<string, StageName> = {
  'research.md': 'researcher',
  'prd.md': 'product_owner',
  'ux-flows.md': 'ux_designer',
  'api-spec.yaml': 'api_designer',
  'components/': 'ui_designer',
  'screenshots/': 'ui_designer',
  'validation-report.md': 'validator',
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSkillsIndex(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_INDEX)) return [];
  return JSON.parse(fs.readFileSync(SKILLS_INDEX, 'utf-8'));
}

function saveSkillsIndex(skills: SkillInfo[]): void {
  ensureDir(SKILLS_DIR);
  fs.writeFileSync(SKILLS_INDEX, JSON.stringify(skills, null, 2));
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns metadata fields and the content after frontmatter.
 */
function parseSkillFrontmatter(raw: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n*([\s\S]*)/);
  if (!fmMatch) return { metadata: {}, content: raw };

  const metadata: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }

  return { metadata, content: fmMatch[2] };
}

// ─── Built-in Skills ──────────────────────────────────────

/**
 * Load built-in skills from .mosaic/evolution/skills/builtin/.
 * Built-in skills have highest priority and cannot be modified by evolution.
 */
function loadBuiltinSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  if (!fs.existsSync(BUILTIN_DIR)) return skills;

  try {
    const entries = fs.readdirSync(BUILTIN_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(BUILTIN_DIR, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, 'utf-8');
      const { metadata } = parseSkillFrontmatter(raw);

      // Parse agents field (YAML array like [coder, tech_lead])
      const agentsStr = metadata.agents ?? '';
      const agents = agentsStr.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      const primaryAgent = (agents[0] ?? 'coder') as StageName;

      skills.push({
        name: metadata.name ?? entry.name,
        scope: (metadata.scope as SkillScope) ?? 'shared',
        description: metadata.description ?? '',
        agentStage: primaryAgent,
        filePath: skillFile,
        proposalId: 'builtin',
        createdAt: 'builtin',
        trigger: metadata.trigger,
        builtin: true,
      });
    }
  } catch { /* directory read error */ }

  return skills;
}

// ─── Scope Classification ──────────────────────────────────

export function classifyScope(proposal: EvolutionProposal): SkillScope {
  if (proposal.skillMetadata?.scope) {
    return proposal.skillMetadata.scope;
  }

  const content = proposal.proposedContent.toLowerCase();
  for (const [artifact, stage] of Object.entries(STAGE_SPECIFIC_ARTIFACTS)) {
    if (content.includes(artifact) && stage === proposal.agentStage) {
      return 'private';
    }
  }

  return 'shared';
}

// ─── Skill Persistence ─────────────────────────────────────

export function persistSkill(proposal: EvolutionProposal): SkillInfo {
  if (!proposal.skillMetadata) {
    throw new Error('Proposal missing skillMetadata');
  }

  const scope = classifyScope(proposal);
  const name = proposal.skillMetadata.name;

  // Determine directory: shared/ or {agent-name}/
  const scopeDir = scope === 'shared'
    ? path.join(SKILLS_DIR, 'shared')
    : path.join(SKILLS_DIR, proposal.agentStage);

  ensureDir(scopeDir);

  // Write SKILL.md with YAML frontmatter (Agent Skills open standard)
  const skillDir = path.join(scopeDir, name);
  ensureDir(skillDir);
  const filePath = path.join(skillDir, 'SKILL.md');

  const triggerLine = proposal.skillMetadata.trigger
    ? `trigger: ${proposal.skillMetadata.trigger}\n`
    : '';

  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${proposal.skillMetadata.description}`,
    `scope: ${scope}`,
    `agent: ${proposal.agentStage}`,
    triggerLine ? triggerLine.trim() : undefined,
    `created: ${new Date().toISOString()}`,
    `proposal: ${proposal.id}`,
    '---',
    '',
  ].filter(Boolean).join('\n');

  fs.writeFileSync(filePath, frontmatter + proposal.proposedContent);

  const skillInfo: SkillInfo = {
    name,
    scope,
    description: proposal.skillMetadata.description,
    agentStage: proposal.agentStage,
    filePath,
    proposalId: proposal.id,
    createdAt: new Date().toISOString(),
    trigger: proposal.skillMetadata.trigger,
  };

  const skills = loadSkillsIndex();
  // Replace if skill with same name exists
  const existingIdx = skills.findIndex((s) => s.name === name && s.scope === scope);
  if (existingIdx >= 0) {
    skills[existingIdx] = skillInfo;
  } else {
    skills.push(skillInfo);
  }
  saveSkillsIndex(skills);

  return skillInfo;
}

// ─── Skill Listing ──────────────────────────────────────────

export function listSkills(stage: StageName): SkillInfo[] {
  // Load from index + builtin, deduplicate (builtin wins on name conflict)
  const indexSkills = loadSkillsIndex();
  const builtinSkills = loadBuiltinSkills();

  const byName = new Map<string, SkillInfo>();

  // Index skills first (lower priority)
  for (const s of indexSkills) {
    if (s.scope === 'shared' || s.agentStage === stage) {
      byName.set(s.name, s);
    }
  }

  // Builtin skills override (highest priority)
  for (const s of builtinSkills) {
    // Check if this builtin applies to this stage
    const raw = fs.existsSync(s.filePath) ? fs.readFileSync(s.filePath, 'utf-8') : '';
    const { metadata } = parseSkillFrontmatter(raw);
    const agentsStr = metadata.agents ?? '';
    const agents = agentsStr.replace(/[\[\]]/g, '').split(',').map(a => a.trim());

    if (s.scope === 'shared' || agents.includes(stage) || s.agentStage === stage) {
      byName.set(s.name, s);
    }
  }

  // Filter out deprecated skills
  return [...byName.values()].filter(s => !s.deprecated);
}

// ─── Progressive Disclosure ─────────────────────────────────

/**
 * Load skills for an agent with progressive disclosure.
 * - Skills with matching triggers: full content injected
 * - Skills without matching triggers: only name + description (summary)
 * - Skills with trigger="always": always fully loaded
 *
 * @param stage The agent stage
 * @param taskContext Optional context string to match triggers against (e.g., input artifacts)
 */
export function loadSkillsForAgent(
  stage: StageName,
  taskContext?: string,
): Map<string, string> {
  const skills = listSkills(stage);
  const result = new Map<string, string>();

  for (const skill of skills) {
    if (!fs.existsSync(skill.filePath)) continue;

    const raw = fs.readFileSync(skill.filePath, 'utf-8');
    const { content } = parseSkillFrontmatter(raw);
    const trigger = skill.trigger;

    // Determine if this skill should be fully loaded
    const shouldFullLoad = !trigger
      || trigger === 'always'
      || (taskContext && matchesTrigger(trigger, taskContext));

    if (shouldFullLoad) {
      result.set(skill.name, content);
    } else {
      // Progressive disclosure: only inject summary
      result.set(skill.name, `[Available skill: ${skill.description}]`);
    }
  }

  return result;
}

/**
 * Simple trigger matching: check if any keyword in the trigger
 * appears in the task context.
 */
function matchesTrigger(trigger: string, context: string): boolean {
  // Split trigger into keywords (Chinese or English, ignoring common words)
  const keywords = trigger
    .split(/[\s,，、]+/)
    .filter(k => k.length > 1)
    .map(k => k.toLowerCase());

  const contextLower = context.toLowerCase();
  return keywords.some(k => contextLower.includes(k));
}

// ─── Skill Lifecycle Management ─────────────────────────────

/**
 * Record that a skill was used in a pipeline run.
 */
export function recordSkillUsage(skillName: string, stage: StageName, _runId: string): void {
  const skills = loadSkillsIndex();
  const skill = skills.find(s => s.name === skillName);
  if (skill) {
    skill.usageCount = (skill.usageCount ?? 0) + 1;
    skill.lastUsedAt = new Date().toISOString();
    saveSkillsIndex(skills);
  }
}

/**
 * Get usage statistics for a skill.
 */
export function getSkillStats(skillName: string): {
  usageCount: number;
  lastUsedAt?: string;
  deprecated: boolean;
} | null {
  const skills = loadSkillsIndex();
  const skill = skills.find(s => s.name === skillName);
  if (!skill) return null;
  return {
    usageCount: skill.usageCount ?? 0,
    lastUsedAt: skill.lastUsedAt,
    deprecated: skill.deprecated ?? false,
  };
}

/**
 * Mark skills as deprecated if unused for longer than threshold.
 */
export function pruneUnusedSkills(thresholdDays: number): string[] {
  const skills = loadSkillsIndex();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  const pruned: string[] = [];

  for (const skill of skills) {
    // Never prune builtin skills
    if (skill.builtin) continue;

    const lastUsed = skill.lastUsedAt ? new Date(skill.lastUsedAt) : new Date(skill.createdAt);
    if (lastUsed < cutoff && !skill.deprecated) {
      skill.deprecated = true;
      pruned.push(skill.name);
    }
  }

  if (pruned.length > 0) {
    saveSkillsIndex(skills);
  }

  return pruned;
}
