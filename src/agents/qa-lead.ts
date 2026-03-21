import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class QALeadAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['test-plan.md'],
      manifest: 'test-plan.manifest.json',
    };
  }
}
