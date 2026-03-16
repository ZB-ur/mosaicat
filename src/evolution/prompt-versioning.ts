import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { StageName, AgentsConfig } from '../core/types.js';
import type { PromptVersion } from './types.js';

const EVOLUTION_DIR = '.mosaic/evolution/prompts';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stageDir(stage: StageName): string {
  return path.join(EVOLUTION_DIR, stage);
}

function versionsPath(stage: StageName): string {
  return path.join(stageDir(stage), 'versions.json');
}

function loadVersions(stage: StageName): PromptVersion[] {
  const p = versionsPath(stage);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveVersions(stage: StageName, versions: PromptVersion[]): void {
  ensureDir(stageDir(stage));
  fs.writeFileSync(versionsPath(stage), JSON.stringify(versions, null, 2));
}

export function getCurrentPromptPath(stage: StageName): string {
  const agentsConfig = yaml.load(
    fs.readFileSync('config/agents.yaml', 'utf-8')
  ) as AgentsConfig;
  const config = agentsConfig.agents[stage];
  if (!config) {
    throw new Error(`No agent config for stage: ${stage}`);
  }
  return config.prompt_file;
}

export function snapshotPrompt(stage: StageName): PromptVersion {
  const promptPath = getCurrentPromptPath(stage);
  const content = fs.readFileSync(promptPath, 'utf-8');

  const versions = loadVersions(stage);
  const nextVersion = versions.length + 1;
  const timestamp = Date.now().toString();
  const fileName = `v${nextVersion}.${timestamp}.md`;
  const filePath = path.join(stageDir(stage), fileName);

  ensureDir(stageDir(stage));
  fs.writeFileSync(filePath, content);

  const version: PromptVersion = {
    version: nextVersion,
    timestamp,
    filePath,
    proposalId: 'snapshot',
    agentStage: stage,
  };

  versions.push(version);
  saveVersions(stage, versions);

  return version;
}

export function applyPromptVersion(
  stage: StageName,
  content: string,
  proposalId: string
): PromptVersion {
  // Snapshot current before overwriting
  snapshotPrompt(stage);

  // Write new content to canonical path
  const promptPath = getCurrentPromptPath(stage);
  fs.writeFileSync(promptPath, content);

  // Record the new version
  const versions = loadVersions(stage);
  const nextVersion = versions.length + 1;
  const timestamp = Date.now().toString();
  const fileName = `v${nextVersion}.${timestamp}.md`;
  const filePath = path.join(stageDir(stage), fileName);

  ensureDir(stageDir(stage));
  fs.writeFileSync(filePath, content);

  const version: PromptVersion = {
    version: nextVersion,
    timestamp,
    filePath,
    proposalId,
    agentStage: stage,
  };

  versions.push(version);
  saveVersions(stage, versions);

  return version;
}

export function rollbackPrompt(stage: StageName, version: number): void {
  const versions = loadVersions(stage);
  const target = versions.find((v) => v.version === version);
  if (!target) {
    throw new Error(`Version ${version} not found for stage ${stage}`);
  }

  if (!fs.existsSync(target.filePath)) {
    throw new Error(`Version file not found: ${target.filePath}`);
  }

  const content = fs.readFileSync(target.filePath, 'utf-8');
  const promptPath = getCurrentPromptPath(stage);
  fs.writeFileSync(promptPath, content);
}

export function listPromptVersions(stage: StageName): PromptVersion[] {
  return loadVersions(stage);
}
