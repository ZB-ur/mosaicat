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
  TechLeadAgent,
  CoderAgent,
  ReviewerAgent,
  ValidatorAgent,
  QALeadAgent,
} from '../agents/index.js';

type AgentConstructor = new (stage: StageName, provider: LLMProvider, logger: Logger) => BaseAgent;

const AGENT_MAP: Partial<Record<StageName, AgentConstructor>> = {
  researcher: ResearcherAgent,
  product_owner: ProductOwnerAgent,
  ux_designer: UXDesignerAgent,
  api_designer: APIDesignerAgent,
  ui_designer: UIDesignerAgent,
  tech_lead: TechLeadAgent,
  coder: CoderAgent,
  reviewer: ReviewerAgent,
  validator: ValidatorAgent,
  qa_lead: QALeadAgent,
  // intent_consultant — handled separately in orchestrator
  // tester, security_auditor — M5
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
