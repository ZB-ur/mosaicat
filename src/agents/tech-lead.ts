import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class TechLeadAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['tech-spec.md'],
      manifest: 'tech-spec.manifest.json',
    };
  }
}
