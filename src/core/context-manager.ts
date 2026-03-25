import fs from 'node:fs';
import path from 'node:path';
import type { StageName, AgentContext, AgentsConfig, Task } from './types.js';
import { readArtifact, artifactExists } from './artifact.js';
import { loadSkillsForAgent } from '../evolution/skill-manager.js';

const STATIC_CONSTITUTION_PATH = path.join('.claude', 'agents', 'mosaic', 'constitution.md');

export function buildContext(
  agentConfig: AgentsConfig,
  task: Task
): AgentContext {
  const config = agentConfig.agents[task.stage];
  if (!config) {
    throw new Error(`No agent config found for stage: ${task.stage}`);
  }

  // Load system prompt
  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(config.prompt_file, 'utf-8');
  } catch {
    systemPrompt = `You are the ${config.name} agent.`;
  }

  // Inject static constitution into system prompt (applies to all agents)
  try {
    const constitutionContent = fs.readFileSync(STATIC_CONSTITUTION_PATH, 'utf-8');
    systemPrompt += `\n\n---\n\n${constitutionContent}`;
  } catch {
    // Static constitution file not found — non-blocking
  }

  // Load only contracted input artifacts (artifact isolation)
  const inputArtifacts = new Map<string, string>();
  for (const input of config.inputs) {
    if (input === 'user_instruction') {
      inputArtifacts.set('user_instruction', task.instruction);
    } else if (input.endsWith('/')) {
      // Directory inputs are markers — agents access them via getArtifactsDir()
      if (artifactExists(input)) {
        inputArtifacts.set(input, `[directory: ${input}]`);
      }
    } else if (artifactExists(input)) {
      inputArtifacts.set(input, readArtifact(input));
    }
  }

  // Inject approved skills into system prompt (after artifacts loaded for trigger context)
  try {
    // Build task context from loaded artifacts for trigger matching
    const taskContext = [...inputArtifacts.values()].join('\n').slice(0, 10000);
    const skills = loadSkillsForAgent(task.stage, taskContext);
    if (skills.size > 0) {
      let skillSection = '\n\n## Available Skills\n';
      for (const [name, content] of skills) {
        skillSection += `\n### Skill: ${name}\n${content}\n`;
      }
      systemPrompt += skillSection;
    }
  } catch (err) {
    console.warn(`[context-manager] Failed to load skills for ${task.stage}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    systemPrompt,
    task,
    inputArtifacts,
  };
}
