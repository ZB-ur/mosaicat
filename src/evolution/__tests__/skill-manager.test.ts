import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { EvolutionProposal } from '../types.js';
import {
  persistSkill,
  classifyScope,
  listSkills,
  loadSkillsForAgent,
} from '../skill-manager.js';

const SKILLS_DIR = '.mosaic/evolution/skills';

function makeProposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    id: 'evo-test',
    type: 'skill_creation',
    agentStage: 'researcher',
    runId: 'run-1',
    reason: 'Reusable comparison pattern',
    proposedContent: '# Structured Comparison\nCompare items in a table format.',
    status: 'approved',
    createdAt: new Date().toISOString(),
    skillMetadata: {
      name: 'structured-comparison',
      scope: 'shared',
      description: 'Compare items in a structured table format',
    },
    ...overrides,
  };
}

describe('skill-manager', () => {
  beforeEach(() => {
    if (fs.existsSync(SKILLS_DIR)) {
      fs.rmSync(SKILLS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(SKILLS_DIR)) {
      fs.rmSync(SKILLS_DIR, { recursive: true });
    }
  });

  describe('classifyScope', () => {
    it('uses skillMetadata.scope when provided', () => {
      const proposal = makeProposal({
        skillMetadata: { name: 'test', scope: 'private', description: 'test' },
      });
      expect(classifyScope(proposal)).toBe('private');
    });

    it('classifies as private when content references stage-specific artifacts', () => {
      const proposal = makeProposal({
        proposedContent: 'This skill analyzes research.md for patterns.',
        skillMetadata: undefined,
      });
      // No skillMetadata.scope, content mentions research.md and agent is researcher
      expect(classifyScope(proposal)).toBe('private');
    });

    it('classifies as shared when content is generic', () => {
      const proposal = makeProposal({
        proposedContent: 'General markdown formatting guidelines.',
        skillMetadata: undefined,
      });
      expect(classifyScope(proposal)).toBe('shared');
    });
  });

  describe('persistSkill', () => {
    it('persists a shared skill to shared/ directory', () => {
      const info = persistSkill(makeProposal());

      expect(info.scope).toBe('shared');
      expect(info.name).toBe('structured-comparison');
      expect(fs.existsSync(info.filePath)).toBe(true);
      expect(fs.readFileSync(info.filePath, 'utf-8')).toContain('Structured Comparison');
    });

    it('persists a private skill to agent directory', () => {
      const info = persistSkill(makeProposal({
        skillMetadata: {
          name: 'deep-analysis',
          scope: 'private',
          description: 'Deep analysis for researcher',
        },
      }));

      expect(info.scope).toBe('private');
      expect(info.filePath).toContain('researcher/deep-analysis.md');
    });

    it('throws when skillMetadata is missing', () => {
      expect(() => persistSkill(makeProposal({ skillMetadata: undefined }))).toThrow(
        'Proposal missing skillMetadata'
      );
    });

    it('replaces existing skill with same name and scope', () => {
      persistSkill(makeProposal());
      const updated = persistSkill(makeProposal({
        proposedContent: '# Updated content',
      }));

      expect(fs.readFileSync(updated.filePath, 'utf-8')).toBe('# Updated content');
      // Index should still have only 1 entry
      const skills = listSkills('researcher');
      const matching = skills.filter((s) => s.name === 'structured-comparison');
      expect(matching.length).toBe(1);
    });
  });

  describe('listSkills', () => {
    it('returns empty array when no skills exist', () => {
      expect(listSkills('researcher')).toEqual([]);
    });

    it('returns shared skills for any agent', () => {
      persistSkill(makeProposal());

      expect(listSkills('researcher').length).toBe(1);
      expect(listSkills('product_owner').length).toBe(1);
      expect(listSkills('validator').length).toBe(1);
    });

    it('returns private skills only for matching agent', () => {
      persistSkill(makeProposal({
        skillMetadata: {
          name: 'private-skill',
          scope: 'private',
          description: 'Only for researcher',
        },
      }));

      expect(listSkills('researcher').length).toBe(1);
      expect(listSkills('product_owner').length).toBe(0);
    });
  });

  describe('loadSkillsForAgent', () => {
    it('returns Map of skill name to content', () => {
      persistSkill(makeProposal());

      const skills = loadSkillsForAgent('researcher');
      expect(skills.size).toBe(1);
      expect(skills.get('structured-comparison')).toContain('Structured Comparison');
    });

    it('includes both shared and private skills for matching agent', () => {
      persistSkill(makeProposal());
      persistSkill(makeProposal({
        id: 'evo-2',
        skillMetadata: {
          name: 'private-skill',
          scope: 'private',
          description: 'Private',
        },
        proposedContent: '# Private skill',
      }));

      const skills = loadSkillsForAgent('researcher');
      expect(skills.size).toBe(2);
    });

    it('returns empty map when no skills exist', () => {
      expect(loadSkillsForAgent('researcher').size).toBe(0);
    });
  });
});
