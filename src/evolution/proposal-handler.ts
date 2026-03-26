import type { InteractionHandler } from '../core/interaction-handler.js';
import { eventBus } from '../core/event-bus.js';
import type { EvolutionProposal } from './types.js';
import { applyPromptVersion } from './prompt-versioning.js';
import { persistSkill } from './skill-manager.js';
import { EvolutionEngine } from './engine.js';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';

export class ProposalHandler {
  private handler: InteractionHandler;
  private engine: EvolutionEngine;

  constructor(
    handler: InteractionHandler,
    provider: LLMProvider,
    logger: Logger
  ) {
    this.handler = handler;
    this.engine = new EvolutionEngine(provider, logger);
  }

  async processProposals(proposals: EvolutionProposal[]): Promise<void> {
    const stateResult = this.engine.loadState();
    const state = stateResult.ok ? stateResult.value : { proposals: [], promptVersions: {}, cooldowns: {} };

    for (const proposal of proposals) {
      eventBus.emit('evolution:proposed', proposal.id, proposal.agentStage);

      if (!this.handler.onEvolutionProposal) {
        // Handler doesn't support evolution — auto-reject
        proposal.status = 'rejected';
        proposal.resolvedAt = new Date().toISOString();
        proposal.rejectionReason = 'Handler does not support evolution proposals';
        eventBus.emit('evolution:rejected', proposal.id, proposal.agentStage);
        continue;
      }

      const result = await this.handler.onEvolutionProposal(proposal);

      if (result.approved) {
        proposal.status = 'approved';
        proposal.resolvedAt = new Date().toISOString();
        proposal.resolvedBy = 'human';

        if (proposal.type === 'prompt_modification') {
          applyPromptVersion(
            proposal.agentStage,
            proposal.proposedContent,
            proposal.id
          );
        } else if (proposal.type === 'skill_creation') {
          persistSkill(proposal);
        }

        eventBus.emit('evolution:approved', proposal.id, proposal.agentStage);
      } else {
        proposal.status = 'rejected';
        proposal.resolvedAt = new Date().toISOString();
        proposal.rejectionReason = result.reason;

        eventBus.emit('evolution:rejected', proposal.id, proposal.agentStage);
      }

      // Update proposal in state
      const idx = state.proposals.findIndex((p: EvolutionProposal) => p.id === proposal.id);
      if (idx >= 0) {
        state.proposals[idx] = proposal;
      }
    }

    this.engine.saveState(state);
  }
}
