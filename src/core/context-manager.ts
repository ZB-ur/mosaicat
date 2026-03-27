import fs from 'node:fs';
import path from 'node:path';
import type { StageName, AgentContext, AgentsConfig, Task } from './types.js';
import type { ArtifactStore } from './artifact-store.js';
import type { Logger } from './logger.js';
import { loadSkillsForAgent } from '../evolution/skill-manager.js';

const STATIC_CONSTITUTION_PATH = path.join('.claude', 'agents', 'mosaic', 'constitution.md');

export function buildContext(
  agentConfig: AgentsConfig,
  task: Task,
  store: ArtifactStore,
  logger: Logger,
  devMode: boolean,
): AgentContext {
  const config = agentConfig.agents[task.stage];
  if (!config) {
    throw new Error(`No agent config found for stage: ${task.stage}`);
  }

  // Load system prompt (Tier 1 — critical file)
  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(config.prompt_file, 'utf-8');
  } catch (e) {
    if (devMode) {
      logger.pipeline('warn', 'context:prompt-missing', {
        stage: task.stage,
        file: config.prompt_file,
        error: e instanceof Error ? e.message : String(e),
      });
      systemPrompt = `You are the ${config.name} agent.`;
    } else {
      throw new Error(`Required prompt file missing: ${config.prompt_file}`);
    }
  }

  // Inject static constitution into system prompt (Tier 2 — non-critical)
  try {
    const constitutionContent = fs.readFileSync(STATIC_CONSTITUTION_PATH, 'utf-8');
    systemPrompt += `\n\n---\n\n${constitutionContent}`;
  } catch (e) {
    logger.pipeline('warn', 'context:constitution-missing', {
      file: STATIC_CONSTITUTION_PATH,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Load only contracted input artifacts (artifact isolation)
  const inputArtifacts = new Map<string, string>();
  for (const input of config.inputs) {
    if (input === 'user_instruction') {
      inputArtifacts.set('user_instruction', task.instruction);
    } else if (input.endsWith('/')) {
      // Directory inputs are markers — agents access them via store.getDir()
      if (store.exists(input)) {
        inputArtifacts.set(input, `[directory: ${input}]`);
      }
    } else if (store.exists(input)) {
      inputArtifacts.set(input, store.read(input));
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
    logger.pipeline('warn', 'context:skills-load-failed', {
      stage: task.stage,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    systemPrompt,
    task,
    inputArtifacts,
  };
}
