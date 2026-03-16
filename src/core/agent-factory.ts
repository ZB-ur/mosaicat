import type { StageName } from './types.js';
import type { LLMProvider } from './llm-provider.js';
import type { Logger } from './logger.js';
import { BaseAgent, StubAgent } from './agent.js';
import { StubProvider } from './llm-provider.js';
import {
  ResearcherAgent,
  ProductOwnerAgent,
  UXDesignerAgent,
  APIDesignerAgent,
  UIDesignerAgent,
  ValidatorAgent,
} from '../agents/index.js';

const AGENT_MAP: Record<StageName, new (stage: StageName, provider: LLMProvider, logger: Logger) => BaseAgent> = {
  researcher: ResearcherAgent,
  product_owner: ProductOwnerAgent,
  ux_designer: UXDesignerAgent,
  api_designer: APIDesignerAgent,
  ui_designer: UIDesignerAgent,
  validator: ValidatorAgent,
};

export function createAgent(stage: StageName, provider: LLMProvider, logger: Logger): BaseAgent {
  // Use StubAgent when provider is StubProvider (Phase 1 compatibility)
  if (provider instanceof StubProvider) {
    return new StubAgent(stage, provider, logger);
  }

  const AgentClass = AGENT_MAP[stage];
  return new AgentClass(stage, provider, logger);
}
