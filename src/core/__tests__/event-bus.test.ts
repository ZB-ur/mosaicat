import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive events', () => {
    const received: string[] = [];
    bus.on('stage:start', (stage, runId) => {
      received.push(`${stage}:${runId}`);
    });
    bus.emit('stage:start', 'researcher', 'run-1');
    expect(received).toEqual(['researcher:run-1']);
  });

  it('should support multiple listeners', () => {
    let count = 0;
    bus.on('pipeline:start', () => count++);
    bus.on('pipeline:start', () => count++);
    bus.emit('pipeline:start', 'run-1');
    expect(count).toBe(2);
  });

  it('should remove listeners with off', () => {
    let count = 0;
    const handler = () => { count++; };
    bus.on('pipeline:complete', handler);
    bus.emit('pipeline:complete', 'run-1');
    expect(count).toBe(1);
    bus.off('pipeline:complete', handler);
    bus.emit('pipeline:complete', 'run-1');
    expect(count).toBe(1);
  });
});
