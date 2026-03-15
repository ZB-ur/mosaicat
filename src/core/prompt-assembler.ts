import type { AgentContext } from './types.js';

export interface OutputSpec {
  artifacts: string[];
  manifest?: string;
}

export function assemblePrompt(context: AgentContext, outputSpec: OutputSpec): string {
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

  // Output Requirements section
  const outputLines: string[] = [];
  outputLines.push('Please produce the following outputs using the delimiter format shown below.\n');

  for (const artifact of outputSpec.artifacts) {
    outputLines.push(`### ${artifact}`);
    outputLines.push(`Wrap the content with:`);
    outputLines.push(`\`<!-- ARTIFACT:${artifact} -->\``);
    outputLines.push(`...content...`);
    outputLines.push(`\`<!-- END:${artifact} -->\``);
    outputLines.push('');
  }

  if (outputSpec.manifest) {
    outputLines.push(`### ${outputSpec.manifest}`);
    outputLines.push(`Wrap the JSON manifest with:`);
    outputLines.push(`\`<!-- MANIFEST:${outputSpec.manifest} -->\``);
    outputLines.push(`...JSON...`);
    outputLines.push(`\`<!-- END:MANIFEST -->\``);
    outputLines.push('');
  }

  outputLines.push('If you need clarification from the user before producing output, wrap your question with:');
  outputLines.push('`<!-- CLARIFICATION -->`');
  outputLines.push('...question...');
  outputLines.push('`<!-- END:CLARIFICATION -->`');

  sections.push(`## Output Requirements\n${outputLines.join('\n')}`);

  return sections.join('\n\n');
}
