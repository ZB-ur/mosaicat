import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class APIDesignerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['api-spec.yaml'],
      manifest: 'api-spec.manifest.json',
    };
  }
}
