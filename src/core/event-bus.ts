import { EventEmitter } from 'eventemitter3';
import type { StageName } from './types.js';

export interface PipelineEvents {
  'stage:start': (stage: StageName, runId: string) => void;
  'stage:complete': (stage: StageName, runId: string) => void;
  'stage:failed': (stage: StageName, runId: string, error: string) => void;
  'stage:awaiting_human': (stage: StageName, runId: string) => void;
  'stage:approved': (stage: StageName, runId: string) => void;
  'stage:rejected': (stage: StageName, runId: string) => void;
  'stage:rollback': (from: StageName, to: StageName, runId: string) => void;
  'pipeline:start': (runId: string) => void;
  'pipeline:complete': (runId: string) => void;
  'pipeline:failed': (runId: string, error: string) => void;
  'issue:created': (issueNumber: number, stage: StageName, runId: string) => void;
  'issue:closed': (issueNumber: number, stage: StageName, runId: string) => void;
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

export const eventBus = new EventBus();
export { EventBus };
