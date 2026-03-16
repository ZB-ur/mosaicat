import readline from 'node:readline';
import type { StageName } from './types.js';
import type { EvolutionProposal } from '../evolution/types.js';

export interface EvolutionApprovalResult {
  approved: boolean;
  reason?: string;
}

export interface InteractionHandler {
  onManualGate(stage: StageName, runId: string): Promise<boolean>;
  onClarification(stage: StageName, question: string, runId: string): Promise<string>;
  onEvolutionProposal?(proposal: EvolutionProposal): Promise<EvolutionApprovalResult>;
}

export class CLIInteractionHandler implements InteractionHandler {
  private askUser(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  async onManualGate(stage: StageName, _runId: string): Promise<boolean> {
    const answer = await this.askUser(`[${stage}] Review artifacts and approve? (yes/no): `);
    return answer.toLowerCase().startsWith('y');
  }

  async onClarification(stage: StageName, question: string, _runId: string): Promise<string> {
    console.log(`\n[${stage}] Agent needs clarification:`);
    console.log(question);
    return this.askUser('\nYour answer: ');
  }

  async onEvolutionProposal(proposal: EvolutionProposal): Promise<EvolutionApprovalResult> {
    console.log(`\n[evolution] ${proposal.type} proposal for ${proposal.agentStage}:`);
    console.log(`  Reason: ${proposal.reason}`);
    if (proposal.skillMetadata) {
      console.log(`  Skill: ${proposal.skillMetadata.name} (${proposal.skillMetadata.scope})`);
    }
    console.log(`  Content preview: ${proposal.proposedContent.slice(0, 200)}...`);
    const answer = await this.askUser('\nApprove this evolution? (yes/no): ');
    const approved = answer.toLowerCase().startsWith('y');
    if (!approved) {
      const reason = await this.askUser('Rejection reason (optional): ');
      return { approved: false, reason: reason || undefined };
    }
    return { approved: true };
  }
}

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

export class DeferredInteractionHandler implements InteractionHandler {
  private pendingGates = new Map<string, DeferredPromise<boolean>>();
  private pendingClarifications = new Map<string, DeferredPromise<string>>();
  private pendingEvolutions = new Map<string, DeferredPromise<EvolutionApprovalResult>>();

  async onManualGate(_stage: StageName, runId: string): Promise<boolean> {
    const deferred = createDeferredPromise<boolean>();
    this.pendingGates.set(runId, deferred);
    return deferred.promise;
  }

  async onClarification(_stage: StageName, _question: string, runId: string): Promise<string> {
    const deferred = createDeferredPromise<string>();
    this.pendingClarifications.set(runId, deferred);
    return deferred.promise;
  }

  approve(runId: string): void {
    const deferred = this.pendingGates.get(runId);
    if (deferred) {
      this.pendingGates.delete(runId);
      deferred.resolve(true);
    }
  }

  reject(runId: string): void {
    const deferred = this.pendingGates.get(runId);
    if (deferred) {
      this.pendingGates.delete(runId);
      deferred.resolve(false);
    }
  }

  answerClarification(runId: string, answer: string): void {
    const deferred = this.pendingClarifications.get(runId);
    if (deferred) {
      this.pendingClarifications.delete(runId);
      deferred.resolve(answer);
    }
  }

  hasPendingGate(runId: string): boolean {
    return this.pendingGates.has(runId);
  }

  hasPendingClarification(runId: string): boolean {
    return this.pendingClarifications.has(runId);
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
