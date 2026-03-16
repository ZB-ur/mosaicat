import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  snapshotPrompt,
  applyPromptVersion,
  rollbackPrompt,
  listPromptVersions,
  getCurrentPromptPath,
} from '../prompt-versioning.js';

const PROMPT_FILE = '.claude/agents/mosaic/researcher.md';
const EVOLUTION_DIR = '.mosaic/evolution/prompts';

describe('prompt-versioning', () => {
  let originalContent: string;

  beforeEach(() => {
    originalContent = fs.readFileSync(PROMPT_FILE, 'utf-8');
    if (fs.existsSync(EVOLUTION_DIR)) {
      fs.rmSync(EVOLUTION_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Restore original prompt
    fs.writeFileSync(PROMPT_FILE, originalContent);
    if (fs.existsSync(EVOLUTION_DIR)) {
      fs.rmSync(EVOLUTION_DIR, { recursive: true });
    }
  });

  it('getCurrentPromptPath returns correct path from agents.yaml', () => {
    const p = getCurrentPromptPath('researcher');
    expect(p).toBe('.claude/agents/mosaic/researcher.md');
  });

  it('snapshotPrompt creates a version file and updates versions.json', () => {
    const version = snapshotPrompt('researcher');

    expect(version.version).toBe(1);
    expect(version.agentStage).toBe('researcher');
    expect(version.proposalId).toBe('snapshot');
    expect(fs.existsSync(version.filePath)).toBe(true);

    const snapshotContent = fs.readFileSync(version.filePath, 'utf-8');
    expect(snapshotContent).toBe(originalContent);
  });

  it('snapshotPrompt increments version numbers', () => {
    const v1 = snapshotPrompt('researcher');
    const v2 = snapshotPrompt('researcher');

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it('applyPromptVersion snapshots current, writes new content, and records version', () => {
    const newContent = '# Evolved Researcher Prompt\nImproved version.';
    const version = applyPromptVersion('researcher', newContent, 'evo-123');

    // Canonical prompt should be updated
    const currentPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
    expect(currentPrompt).toBe(newContent);

    // Version file should contain new content
    const versionContent = fs.readFileSync(version.filePath, 'utf-8');
    expect(versionContent).toBe(newContent);

    // Should have 2 versions: snapshot of original + new
    const versions = listPromptVersions('researcher');
    expect(versions.length).toBe(2);
    expect(versions[0].proposalId).toBe('snapshot');
    expect(versions[1].proposalId).toBe('evo-123');
  });

  it('rollbackPrompt restores a previous version', () => {
    const newContent = '# Evolved prompt';
    applyPromptVersion('researcher', newContent, 'evo-456');

    // Current prompt should be the new content
    expect(fs.readFileSync(PROMPT_FILE, 'utf-8')).toBe(newContent);

    // Rollback to version 1 (the original snapshot)
    rollbackPrompt('researcher', 1);

    const restored = fs.readFileSync(PROMPT_FILE, 'utf-8');
    expect(restored).toBe(originalContent);
  });

  it('rollbackPrompt throws for non-existent version', () => {
    expect(() => rollbackPrompt('researcher', 99)).toThrow('Version 99 not found');
  });

  it('listPromptVersions returns empty array when no versions exist', () => {
    const versions = listPromptVersions('researcher');
    expect(versions).toEqual([]);
  });

  it('listPromptVersions returns all versions in order', () => {
    snapshotPrompt('researcher');
    applyPromptVersion('researcher', '# v2', 'evo-1');
    applyPromptVersion('researcher', '# v3', 'evo-2');

    const versions = listPromptVersions('researcher');
    // 1 manual snapshot + 2 applies (each creates snapshot + new = 2 each) = 1 + 2 + 2 = 5
    expect(versions.length).toBe(5);
    expect(versions[0].version).toBe(1);
    expect(versions[versions.length - 1].version).toBe(5);
  });
});
