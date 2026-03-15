import fs from 'node:fs';
import type { StageName, AgentContext, AgentsConfig, Task } from './types.js';
import { readArtifact, artifactExists } from './artifact.js';

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
