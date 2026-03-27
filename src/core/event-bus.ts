import { EventEmitter } from 'eventemitter3';
import type { StageName } from './types.js';

export interface PipelineEvents {
  'stage:start': (stage: StageName, runId: string) => void;
  'stage:complete': (stage: StageName, runId: string) => void;
  'stage:skipped': (stage: StageName, runId: string) => void;
  'stage:failed': (stage: StageName, runId: string, error: string) => void;
  'stage:awaiting_human': (stage: StageName, runId: string) => void;
  'stage:approved': (stage: StageName, runId: string) => void;
  'stage:rejected': (stage: StageName, runId: string) => void;
  'stage:rollback': (from: StageName, to: StageName, runId: string) => void;
  'stage:retry': (stage: StageName, runId: string, attempt: number) => void;
  'pipeline:start': (runId: string, stages?: readonly StageName[], provider?: string, artifactsDir?: string) => void;
  'pipeline:complete': (runId: string) => void;
  'pipeline:failed': (runId: string, error: string) => void;
  'issue:created': (issueNumber: number, stage: StageName, runId: string) => void;
  'issue:closed': (issueNumber: number, stage: StageName, runId: string) => void;
  'agent:context': (stage: StageName, inputs: string[]) => void;
  'agent:thinking': (stage: StageName, promptLength: number) => void;
  'agent:response': (stage: StageName, responseLength: number) => void;
  'agent:progress': (stage: StageName, message: string) => void;
  'agent:clarification': (stage: StageName, question: string) => void;
  'clarification:answered': (stage: StageName, question: string, answer: string, source: string) => void;
  'artifact:written': (stage: StageName, name: string, size: number) => void;
  'manifest:written': (stage: StageName, name: string) => void;
  'snapshot:created': (stage: StageName, runId: string) => void;
  'agent:summary': (stage: StageName, summary: string) => void;
  'coder:fix-round': (round: number, totalTests: number, passedTests: number, approach: string) => void;
  'evolution:proposals': (proposals: Array<{ id: string; type: string; reason: string }>) => void;
  'evolution:analyzing': (runId: string) => void;
  'evolution:proposed': (proposalId: string, stage: StageName) => void;
  'evolution:approved': (proposalId: string, stage: StageName) => void;
  'evolution:rejected': (proposalId: string, stage: StageName) => void;
  'evolution:complete': (runId: string, proposalCount: number) => void;
}

type EventName = keyof PipelineEvents;

class EventBus {
  private emitter = new EventEmitter();

  emit<E extends EventName>(event: E, ...args: Parameters<PipelineEvents[E]>): void {
    this.emitter.emit(event, ...args);
  }

  on<E extends EventName>(event: E, handler: PipelineEvents[E]): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<E extends EventName>(event: E, handler: PipelineEvents[E]): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

export { EventBus };
