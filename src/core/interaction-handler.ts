import { select, input } from '@inquirer/prompts';
import type { StageName, ClarificationOption, GateResult } from './types.js';
import type { EvolutionProposal } from '../evolution/types.js';

export interface EvolutionApprovalResult {
  approved: boolean;
  reason?: string;
}

export interface InteractionHandler {
  onManualGate(stage: StageName, runId: string): Promise<GateResult>;
  onClarification(
    stage: StageName, question: string, runId: string,
    options?: ClarificationOption[], allowCustom?: boolean
  ): Promise<string>;
  onEvolutionProposal?(proposal: EvolutionProposal): Promise<EvolutionApprovalResult>;
}

export class CLIInteractionHandler implements InteractionHandler {
  async onManualGate(stage: StageName, _runId: string): Promise<GateResult> {
    console.log(`\n\x1b[33m🔍 [${stage}] Review the artifacts above and decide:\x1b[0m\n`);

    const action = await select({
      message: 'Decision:',
      choices: [
        { name: '✓ Approve', value: 'approve' },
        { name: '✗ Reject with feedback', value: 'reject' },
      ],
    });

    if (action === 'approve') {
      return { approved: true };
    }

    // Collect feedback on rejection
    const feedback = await input({
      message: 'What needs to change?',
    });

    const result: GateResult = { approved: false, feedback: feedback || undefined };

    // For UIDesigner, offer component selection
    if (stage === 'ui_designer') {
      const components = await input({
        message: 'Which components need rework? (comma-separated names, or "all"):',
      });
      if (components && components.trim().toLowerCase() !== 'all') {
        result.retryComponents = components.split(',').map((c) => c.trim()).filter(Boolean);
      }
    }

    return result;
  }

  async onClarification(
    stage: StageName, question: string, _runId: string,
    options?: ClarificationOption[], allowCustom?: boolean
  ): Promise<string> {
    console.log(`\n\x1b[33m❓ [${stage}] Agent needs your input:\x1b[0m`);
    console.log(`   ${question}\n`);

    if (options && options.length > 0) {
      const choices = options.map((opt) => ({
        name: opt.description ? `${opt.label} — ${opt.description}` : opt.label,
        value: opt.label,
      }));

      if (allowCustom !== false) {
        choices.push({ name: '✏️  Custom input...', value: '__custom__' });
      }

      const answer = await select({
        message: 'Select an option:',
        choices,
      });

      if (answer === '__custom__') {
        return input({ message: 'Your answer:' });
      }

      return answer;
    }

    return input({ message: 'Your answer:' });
  }

  async onEvolutionProposal(proposal: EvolutionProposal): Promise<EvolutionApprovalResult> {
    console.log(`\n\x1b[35m[evolution]\x1b[0m ${proposal.type} proposal for ${proposal.agentStage}:`);
    console.log(`  Reason: ${proposal.reason}`);
    if (proposal.skillMetadata) {
      console.log(`  Skill: ${proposal.skillMetadata.name} (${proposal.skillMetadata.scope})`);
    }
    console.log(`  Content preview: ${proposal.proposedContent.slice(0, 200)}...`);

    const action = await select({
      message: 'Approve this evolution?',
      choices: [
        { name: '✓ Approve', value: 'approve' },
        { name: '✗ Reject', value: 'reject' },
      ],
    });

    if (action === 'approve') {
      return { approved: true };
    }

    const reason = await input({
      message: 'Rejection reason (optional):',
    });
    return { approved: false, reason: reason || undefined };
  }
}

// --- Deferred Interaction Handler (MCP mode) ---

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface ClarificationMeta {
  question: string;
  options?: ClarificationOption[];
  allowCustom?: boolean;
}

export class DeferredInteractionHandler implements InteractionHandler {
  private pendingGates = new Map<string, DeferredPromise<GateResult>>();
  private pendingClarifications = new Map<string, DeferredPromise<string>>();
  private pendingEvolutions = new Map<string, DeferredPromise<EvolutionApprovalResult>>();
  private clarificationMeta = new Map<string, ClarificationMeta>();

  async onManualGate(_stage: StageName, runId: string): Promise<GateResult> {
    const deferred = createDeferredPromise<GateResult>();
    this.pendingGates.set(runId, deferred);
    return deferred.promise;
  }

  async onClarification(
    _stage: StageName, question: string, runId: string,
    options?: ClarificationOption[], allowCustom?: boolean
  ): Promise<string> {
    const deferred = createDeferredPromise<string>();
    this.pendingClarifications.set(runId, deferred);
    this.clarificationMeta.set(runId, { question, options, allowCustom });
    return deferred.promise;
  }

  approve(runId: string): void {
    const deferred = this.pendingGates.get(runId);
    if (deferred) {
      this.pendingGates.delete(runId);
      deferred.resolve({ approved: true });
    }
  }

  reject(runId: string, feedback?: string, retryComponents?: string[]): void {
    const deferred = this.pendingGates.get(runId);
    if (deferred) {
      this.pendingGates.delete(runId);
      deferred.resolve({ approved: false, feedback, retryComponents });
    }
  }

  answerClarification(runId: string, answer: string): void {
    const deferred = this.pendingClarifications.get(runId);
    if (deferred) {
      this.pendingClarifications.delete(runId);
      this.clarificationMeta.delete(runId);
      deferred.resolve(answer);
    }
  }

  hasPendingGate(runId: string): boolean {
    return this.pendingGates.has(runId);
  }

  hasPendingClarification(runId: string): boolean {
    return this.pendingClarifications.has(runId);
  }

  getClarificationMeta(runId: string): ClarificationMeta | undefined {
    return this.clarificationMeta.get(runId);
  }

  async onEvolutionProposal(proposal: EvolutionProposal): Promise<EvolutionApprovalResult> {
    const deferred = createDeferredPromise<EvolutionApprovalResult>();
    this.pendingEvolutions.set(proposal.id, deferred);
    return deferred.promise;
  }

  approveEvolution(proposalId: string): void {
    const deferred = this.pendingEvolutions.get(proposalId);
    if (deferred) {
      this.pendingEvolutions.delete(proposalId);
      deferred.resolve({ approved: true });
    }
  }

  rejectEvolution(proposalId: string, reason?: string): void {
    const deferred = this.pendingEvolutions.get(proposalId);
    if (deferred) {
      this.pendingEvolutions.delete(proposalId);
      deferred.resolve({ approved: false, reason });
    }
  }

  hasPendingEvolution(proposalId: string): boolean {
    return this.pendingEvolutions.has(proposalId);
  }
}
