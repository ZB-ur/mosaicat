import type { StageName, AgentAutonomyConfig } from './types.js';
import type { RunContext } from './run-context.js';
import type { InteractionHandler } from './interaction-handler.js';
import { BaseAgent, StubAgent } from './agent.js';
import { StubProvider } from './llm-provider.js';
import { getHooksForStage } from './hooks/index.js';
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
  TesterAgent,
  SecurityAuditorAgent,
} from '../agents/index.js';

type AgentConstructor = new (stage: StageName, ctx: RunContext) => BaseAgent;

const AGENT_MAP: Partial<Record<StageName, AgentConstructor>> = {
  researcher: ResearcherAgent,
  product_owner: ProductOwnerAgent,
  ux_designer: UXDesignerAgent,
  api_designer: APIDesignerAgent,
  ui_designer: UIDesignerAgent,
  tech_lead: TechLeadAgent,
  // coder — created specially to receive interactionHandler
  reviewer: ReviewerAgent,
  validator: ValidatorAgent,
  qa_lead: QALeadAgent,
  tester: TesterAgent,
  security_auditor: SecurityAuditorAgent,
  // intent_consultant — handled separately in orchestrator
};

function registerHooks(agent: BaseAgent, stage: StageName): void {
  const hooks = getHooksForStage(stage);
  for (const hook of hooks.preRun) {
    agent.addPreRunHook(hook);
  }
  for (const hook of hooks.postRun) {
    agent.addPostRunHook(hook);
  }
}

export function createAgent(
  stage: StageName,
  ctx: RunContext,
  _autonomy?: AgentAutonomyConfig,
  interactionHandler?: InteractionHandler,
): BaseAgent {
  // Use StubAgent when provider is StubProvider (Phase 1 compatibility)
  if (ctx.provider instanceof StubProvider) {
    return new StubAgent(stage, ctx);
  }

  let agent: BaseAgent;

  // Coder needs InteractionHandler for retry confirmation
  if (stage === 'coder') {
    agent = new CoderAgent(stage, ctx, interactionHandler);
  } else {
    const AgentClass = AGENT_MAP[stage];
    if (!AgentClass) {
      throw new Error(`No agent implementation registered for stage: ${stage}`);
    }
    agent = new AgentClass(stage, ctx);
  }

  // Register quality hooks for this stage
  registerHooks(agent, stage);

  return agent;
}
