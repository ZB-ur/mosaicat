import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class UXDesignerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['ux-flows.md'],
      manifest: 'ux-flows.manifest.json',
    };
  }
}
