import type { AgentContext } from './types.js';

/**
 * OutputSpec defines what an agent produces.
 * - artifacts: file names the agent writes (e.g. 'research.md')
 * - manifest: manifest file name (e.g. 'research.manifest.json')
 */
export interface OutputSpec {
  artifacts: string[];
  manifest?: string;
}

/**
 * Assemble a prompt from agent context.
 * Only includes task description and input artifacts — no output format instructions.
 * Output structure is enforced via --json-schema (structured output) at the provider level.
 */
export function assemblePrompt(context: AgentContext, _outputSpec: OutputSpec): string {
  const sections: string[] = [];

  // Task section
  sections.push(`## Task\n${context.task.instruction}`);

  // Input Artifacts section
  if (context.inputArtifacts.size > 0) {
    const artifactSections: string[] = [];
    for (const [name, content] of context.inputArtifacts) {
      artifactSections.push(`### ${name}\n${content}`);
    }
    sections.push(`## Input Artifacts\n${artifactSections.join('\n\n')}`);
  }

  return sections.join('\n\n');
}
