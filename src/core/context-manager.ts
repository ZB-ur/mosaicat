import fs from 'node:fs';
import type { StageName, AgentContext, AgentsConfig, Task } from './types.js';
import { readArtifact, artifactExists } from './artifact.js';
import { loadSkillsForAgent } from '../evolution/skill-manager.js';

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

  // Inject approved skills into system prompt
  try {
    const skills = loadSkillsForAgent(task.stage);
    if (skills.size > 0) {
      let skillSection = '\n\n## Available Skills\n';
      for (const [name, content] of skills) {
        skillSection += `\n### Skill: ${name}\n${content}\n`;
      }
      systemPrompt += skillSection;
    }
  } catch {
    // Skills not available — continue without them
  }

  // Load only contracted input artifacts (artifact isolation)
  const inputArtifacts = new Map<string, string>();
  for (const input of config.inputs) {
    if (input === 'user_instruction') {
      inputArtifacts.set('user_instruction', task.instruction);
    } else if (artifactExists(input)) {
      inputArtifacts.set(input, readArtifact(input));
    }
  }

  return {
    systemPrompt,
    task,
    inputArtifacts,
  };
}
