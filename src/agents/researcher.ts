import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class ResearcherAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['research.md'],
      manifest: 'research.manifest.json',
    };
  }
}
