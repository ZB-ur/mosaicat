import readline from 'node:readline';
import type { StageName } from './types.js';

export interface InteractionHandler {
  onManualGate(stage: StageName, runId: string): Promise<boolean>;
  onClarification(stage: StageName, question: string, runId: string): Promise<string>;
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
}
