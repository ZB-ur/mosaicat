import readline from 'node:readline';
import type { StageName, ClarificationOption } from './types.js';
import type { EvolutionProposal } from '../evolution/types.js';

export interface EvolutionApprovalResult {
  approved: boolean;
  reason?: string;
}

export interface InteractionHandler {
  onManualGate(stage: StageName, runId: string): Promise<boolean>;
  onClarification(
    stage: StageName, question: string, runId: string,
    options?: ClarificationOption[], allowCustom?: boolean
  ): Promise<string>;
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

  async onClarification(
    stage: StageName, question: string, _runId: string,
    options?: ClarificationOption[], allowCustom?: boolean
  ): Promise<string> {
    console.log(`\n[${stage}] Agent needs clarification:`);
    console.log(question);

    if (options && options.length > 0) {
      return this.showSelection(options, allowCustom ?? true);
    }

    return this.askUser('\nYour answer: ');
  }

  private showSelection(options: ClarificationOption[], allowCustom: boolean): Promise<string> {
    return new Promise((resolve) => {
      const allOptions = [...options];
      if (allowCustom) {
        allOptions.push({ label: '自定义输入...', description: '输入自定义回答' });
      }

      let selected = 0;
      const stdin = process.stdin;
      const isRaw = stdin.isTTY;

      // Render the selection list
      const render = () => {
        // Move cursor up to overwrite previous render (except first time)
        for (let i = 0; i < allOptions.length; i++) {
          const prefix = i === selected ? '\x1b[36m❯\x1b[0m' : ' ';
          const highlight = i === selected ? '\x1b[1m' : '\x1b[2m';
          const reset = '\x1b[0m';
          const desc = allOptions[i].description ? ` \x1b[90m— ${allOptions[i].description}\x1b[0m` : '';
          process.stdout.write(`${prefix} ${highlight}${allOptions[i].label}${reset}${desc}\n`);
        }
        process.stdout.write('\x1b[90m(↑↓ 选择, Enter 确认)\x1b[0m\n');
      };

      const clearRender = () => {
        // Move up and clear lines
        const lines = allOptions.length + 1;
        for (let i = 0; i < lines; i++) {
          process.stdout.write('\x1b[1A\x1b[2K');
        }
      };

      if (!isRaw) {
        // Non-TTY fallback: just show numbered list and use readline
        console.log('');
        for (let i = 0; i < allOptions.length; i++) {
          const desc = allOptions[i].description ? ` — ${allOptions[i].description}` : '';
          console.log(`  ${i + 1}. ${allOptions[i].label}${desc}`);
        }
        this.askUser('\nEnter number: ').then((answer) => {
          const idx = parseInt(answer) - 1;
          if (idx >= 0 && idx < options.length) {
            resolve(options[idx].label);
          } else if (allowCustom && idx === options.length) {
            this.askUser('Your custom answer: ').then(resolve);
          } else {
            resolve(allOptions[0].label);
          }
        });
        return;
      }

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      console.log('');
      render();

      const onKeypress = (key: string) => {
        // Handle arrow keys (escape sequences)
        if (key === '\x1b[A') {
          // Up arrow
          clearRender();
          selected = (selected - 1 + allOptions.length) % allOptions.length;
          render();
        } else if (key === '\x1b[B') {
          // Down arrow
          clearRender();
          selected = (selected + 1) % allOptions.length;
          render();
        } else if (key === '\r' || key === '\n') {
          // Enter
          stdin.removeListener('data', onKeypress);
          stdin.setRawMode(false);
          stdin.pause();
          clearRender();

          const chosen = allOptions[selected];
          console.log(`\x1b[32m✓\x1b[0m ${chosen.label}\n`);

          if (allowCustom && selected === options.length) {
            // Custom input selected
            this.askUser('Your custom answer: ').then(resolve);
          } else {
            resolve(chosen.label);
          }
        } else if (key === '\x03') {
          // Ctrl+C
          stdin.removeListener('data', onKeypress);
          stdin.setRawMode(false);
          stdin.pause();
          resolve(allOptions[0].label);
        }
      };

      stdin.on('data', onKeypress);
    });
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

export interface ClarificationMeta {
  question: string;
  options?: ClarificationOption[];
  allowCustom?: boolean;
}

export class DeferredInteractionHandler implements InteractionHandler {
  private pendingGates = new Map<string, DeferredPromise<boolean>>();
  private pendingClarifications = new Map<string, DeferredPromise<string>>();
  private pendingEvolutions = new Map<string, DeferredPromise<EvolutionApprovalResult>>();
  private clarificationMeta = new Map<string, ClarificationMeta>();

  async onManualGate(_stage: StageName, runId: string): Promise<boolean> {
    const deferred = createDeferredPromise<boolean>();
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
