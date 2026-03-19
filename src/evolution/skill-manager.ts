import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from '../core/types.js';
import type { EvolutionProposal, SkillInfo, SkillScope } from './types.js';

const SKILLS_DIR = '.mosaic/evolution/skills';
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

  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${proposal.skillMetadata.description}`,
    `scope: ${scope}`,
    `agent: ${proposal.agentStage}`,
    `created: ${new Date().toISOString()}`,
    `proposal: ${proposal.id}`,
    '---',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, frontmatter + proposal.proposedContent);

  const skillInfo: SkillInfo = {
    name,
    scope,
    description: proposal.skillMetadata.description,
    agentStage: proposal.agentStage,
    filePath,
    proposalId: proposal.id,
    createdAt: new Date().toISOString(),
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

export function listSkills(stage: StageName): SkillInfo[] {
  const skills = loadSkillsIndex();
  return skills.filter(
    (s) => s.scope === 'shared' || s.agentStage === stage
  );
}

export function loadSkillsForAgent(stage: StageName): Map<string, string> {
  const skills = listSkills(stage);
  const result = new Map<string, string>();

  for (const skill of skills) {
    if (fs.existsSync(skill.filePath)) {
      const raw = fs.readFileSync(skill.filePath, 'utf-8');
      // Strip YAML frontmatter if present
      const content = raw.replace(/^---\n[\s\S]*?\n---\n*/, '');
      result.set(skill.name, content);
    }
  }

  return result;
}
