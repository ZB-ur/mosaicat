import type { StageName, AgentAutonomyConfig } from './types.js';
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

type AgentConstructor = new (stage: StageName, provider: LLMProvider, logger: Logger) => BaseAgent;

const AGENT_MAP: Partial<Record<StageName, AgentConstructor>> = {
  researcher: ResearcherAgent,
  product_owner: ProductOwnerAgent,
  ux_designer: UXDesignerAgent,
  api_designer: APIDesignerAgent,
  ui_designer: UIDesignerAgent,
  validator: ValidatorAgent,
  // tech_lead, coder, reviewer — registered in Phase 6-8
  // intent_consultant — handled separately in orchestrator
  // qa_lead, tester — M4
};

export function createAgent(
  stage: StageName,
  provider: LLMProvider,
  logger: Logger,
  _autonomy?: AgentAutonomyConfig,
): BaseAgent {
  // Use StubAgent when provider is StubProvider (Phase 1 compatibility)
  if (provider instanceof StubProvider) {
    return new StubAgent(stage, provider, logger);
  }

  const AgentClass = AGENT_MAP[stage];
  if (!AgentClass) {
    throw new Error(`No agent implementation registered for stage: ${stage}`);
  }
  return new AgentClass(stage, provider, logger);
}
