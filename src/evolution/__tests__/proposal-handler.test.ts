import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { StageName, GateResult } from '../../core/types.js';
import type { InteractionHandler, EvolutionApprovalResult } from '../../core/interaction-handler.js';
import type { EvolutionProposal } from '../types.js';
import { ProposalHandler } from '../proposal-handler.js';
import { StubProvider } from '../../core/llm-provider.js';
import { Logger } from '../../core/logger.js';
import { listPromptVersions } from '../prompt-versioning.js';
import { listSkills } from '../skill-manager.js';
import { eventBus } from '../../core/event-bus.js';
import { createTestMosaicDir, cleanupTestMosaicDir } from '../../__tests__/test-helpers.js';

const PROMPT_FILE = '.claude/agents/mosaic/researcher.md';

class TestInteractionHandler implements InteractionHandler {
  approvals = new Map<string, EvolutionApprovalResult>();

  async onManualGate(_stage: StageName, _runId: string): Promise<GateResult> {
    return { approved: true };
  }

  async onClarification(_stage: StageName, _question: string, _runId: string): Promise<string> {
    return '';
  }

  async onEvolutionProposal(proposal: EvolutionProposal): Promise<EvolutionApprovalResult> {
    return this.approvals.get(proposal.id) ?? { approved: false, reason: 'not configured' };
  }
}

function makeProposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    id: `evo-test-${Date.now()}`,
    type: 'prompt_modification',
    agentStage: 'researcher',
    runId: 'run-1',
    reason: 'Improve quality',
    proposedContent: '# Evolved prompt\nNew content.',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProposalHandler', () => {
  let originalContent: string;
  let logger: Logger;
  let tmpRoot: string;

  beforeEach(() => {
    originalContent = fs.readFileSync(PROMPT_FILE, 'utf-8');
    tmpRoot = createTestMosaicDir();
    logger = new Logger('test-proposal', path.join(tmpRoot, 'logs'));
  });

  afterEach(async () => {
    fs.writeFileSync(PROMPT_FILE, originalContent);
    await logger.close();
    cleanupTestMosaicDir(tmpRoot);
    eventBus.removeAllListeners();
  });

  it('applies approved prompt_modification proposals', async () => {
    const proposal = makeProposal();
    const handler = new TestInteractionHandler();
    handler.approvals.set(proposal.id, { approved: true });

    const proposalHandler = new ProposalHandler(handler, new StubProvider(), logger);

    // Pre-populate state with the proposal
    const { EvolutionEngine } = await import('../engine.js');
    const engine = new EvolutionEngine(new StubProvider(), logger);
    engine.saveState({ proposals: [proposal], promptVersions: {}, cooldowns: {} });

    await proposalHandler.processProposals([proposal]);

    // Canonical prompt should be updated
    const currentPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
    expect(currentPrompt).toBe('# Evolved prompt\nNew content.');

    // Version history should exist
    const versions = listPromptVersions('researcher');
    expect(versions.length).toBeGreaterThan(0);
  });

  it('persists approved skill_creation proposals', async () => {
    const proposal = makeProposal({
      type: 'skill_creation',
      proposedContent: '# Comparison Skill\nCompare things.',
      skillMetadata: {
        name: 'comparison',
        scope: 'shared',
        description: 'Compare items',
      },
    });
    const handler = new TestInteractionHandler();
    handler.approvals.set(proposal.id, { approved: true });

    const proposalHandler = new ProposalHandler(handler, new StubProvider(), logger);

    const { EvolutionEngine } = await import('../engine.js');
    const engine = new EvolutionEngine(new StubProvider(), logger);
    engine.saveState({ proposals: [proposal], promptVersions: {}, cooldowns: {} });

    await proposalHandler.processProposals([proposal]);

    const skills = listSkills('researcher');
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('comparison');
  });

  it('records rejection with reason', async () => {
    const proposal = makeProposal();
    const handler = new TestInteractionHandler();
    handler.approvals.set(proposal.id, { approved: false, reason: 'Too aggressive' });

    const proposalHandler = new ProposalHandler(handler, new StubProvider(), logger);

    const { EvolutionEngine } = await import('../engine.js');
    const engine = new EvolutionEngine(new StubProvider(), logger);
    engine.saveState({ proposals: [proposal], promptVersions: {}, cooldowns: {} });

    await proposalHandler.processProposals([proposal]);

    expect(proposal.status).toBe('rejected');
    expect(proposal.rejectionReason).toBe('Too aggressive');

    // Prompt should not change
    expect(fs.readFileSync(PROMPT_FILE, 'utf-8')).toBe(originalContent);
  });

  it('emits evolution events', async () => {
    const proposal = makeProposal();
    const handler = new TestInteractionHandler();
    handler.approvals.set(proposal.id, { approved: true });

    const events: string[] = [];
    eventBus.on('evolution:proposed', (id) => events.push(`proposed:${id}`));
    eventBus.on('evolution:approved', (id) => events.push(`approved:${id}`));

    const proposalHandler = new ProposalHandler(handler, new StubProvider(), logger);

    const { EvolutionEngine } = await import('../engine.js');
    const engine = new EvolutionEngine(new StubProvider(), logger);
    engine.saveState({ proposals: [proposal], promptVersions: {}, cooldowns: {} });

    await proposalHandler.processProposals([proposal]);

    expect(events).toContain(`proposed:${proposal.id}`);
    expect(events).toContain(`approved:${proposal.id}`);
  });
});
