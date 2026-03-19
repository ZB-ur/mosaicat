import type { OutputSpec } from '../core/prompt-assembler.js';
import { LLMAgent } from './llm-agent.js';

export class ReviewerAgent extends LLMAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['review-report.md'],
      manifest: 'review.manifest.json',
    };
  }
}
