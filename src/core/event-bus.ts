import { EventEmitter } from 'eventemitter3';
import type { PipelineEvents } from './types.js';

export class EventBus extends (EventEmitter as new () => EventEmitter<PipelineEvents>) {}

// Singleton for the application
let defaultBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!defaultBus) {
    defaultBus = new EventBus();
  }
  return defaultBus;
}

export function resetEventBus(): void {
  if (defaultBus) {
    defaultBus.removeAllListeners();
  }
  defaultBus = null;
}
