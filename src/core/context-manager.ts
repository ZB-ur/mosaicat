import * as fs from 'node:fs';
import * as path from 'node:path';
import { readArtifact, artifactExists, listArtifacts } from './artifact.js';
import type { StageName, AgentConfig, AgentsConfig, StageConfig, Task, AgentContext } from './types.js';

export class ContextManager {
  constructor(
    private agentsConfig: AgentsConfig,
    private projectRoot: string = '.',
  ) {}

  buildContext(
    stage: StageName,
    task: Task,
    stageConfig: StageConfig,
  ): AgentContext {
    const agentConfig = this.agentsConfig.agents[stage];
    const inputArtifacts = this.resolveInputArtifacts(agentConfig, task);
    const systemPrompt = this.loadPrompt(agentConfig);

    return {
      systemPrompt,
      task,
      inputArtifacts,
      stageConfig,
      agentConfig,
    };
  }

  private resolveInputArtifacts(
    config: AgentConfig,
    task: Task,
  ): { name: string; path: string; content?: string }[] {
    const artifacts: { name: string; path: string; content?: string }[] = [];

    for (const input of config.input) {
      if (input === 'user_instruction') {
        artifacts.push({
          name: 'user_instruction',
          path: '',
          content: task.instruction,
        });
      } else if (input.includes('*')) {
        // Glob pattern (e.g., "*.manifest.json")
        const allArtifacts = listArtifacts(this.projectRoot);
        const pattern = input.replace('*', '');
        for (const name of allArtifacts) {
          if (name.endsWith(pattern.replace('*.', '.')) || name.includes(pattern.replace('*', ''))) {
            artifacts.push({
              name,
              path: name,
              content: readArtifact(name, this.projectRoot),
            });
          }
        }
      } else if (artifactExists(input, this.projectRoot)) {
        artifacts.push({
          name: input,
          path: input,
          content: readArtifact(input, this.projectRoot),
        });
      }
    }

    return artifacts;
  }

  private loadPrompt(config: AgentConfig): string {
    const promptPath = path.resolve(this.projectRoot, config.prompt);
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf-8');
    }
    return `Agent prompt not found at ${config.prompt}`;
  }
}
