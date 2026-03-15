import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../event-bus.js';
import type { PipelineRun, StageName } from '../types.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive pipeline events', () => {
    const received: string[] = [];
    const mockRun = { id: 'test-run' } as PipelineRun;

    bus.on('pipeline:started', (run) => {
      received.push(`started:${run.id}`);
    });
    bus.on('pipeline:completed', (run) => {
      received.push(`completed:${run.id}`);
    });

    bus.emit('pipeline:started', mockRun);
    bus.emit('pipeline:completed', mockRun);

    expect(received).toEqual(['started:test-run', 'completed:test-run']);
  });

  it('should emit and receive stage events', () => {
    const received: string[] = [];
    const mockRun = { id: 'test-run' } as PipelineRun;

    bus.on('stage:started', (stage, run) => {
      received.push(`${stage}:started`);
    });
    bus.on('stage:completed', (stage, run) => {
      received.push(`${stage}:completed`);
    });

    bus.emit('stage:started', 'researcher', mockRun);
    bus.emit('stage:completed', 'researcher', mockRun);

    expect(received).toEqual(['researcher:started', 'researcher:completed']);
  });

  it('should emit agent events', () => {
    const stages: StageName[] = [];
    const durations: number[] = [];

    bus.on('agent:llm_call', (stage, duration) => {
      stages.push(stage);
      durations.push(duration);
    });

    bus.emit('agent:llm_call', 'ux_designer', 150);

    expect(stages).toEqual(['ux_designer']);
    expect(durations).toEqual([150]);
  });
});
