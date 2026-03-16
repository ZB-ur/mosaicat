import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class ProductOwnerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['prd.md'],
      manifest: 'prd.manifest.json',
    };
  }
}
