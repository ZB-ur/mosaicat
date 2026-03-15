import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EventBus } from './event-bus.js';
import type { StageName } from './types.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private runDir: string;
  private agentsDir: string;

  constructor(
    private baseDir: string,
    private runId: string,
  ) {
    this.runDir = path.join(baseDir, `run-${runId}`);
    this.agentsDir = path.join(this.runDir, 'agents');
    fs.mkdirSync(this.agentsDir, { recursive: true });
  }

  get runDirectory(): string {
    return this.runDir;
  }

  subscribe(bus: EventBus): void {
    bus.on('pipeline:started', (run) => {
      this.pipeline('info', 'pipeline:started', { runId: run.id, task: run.task.instruction });
    });
    bus.on('pipeline:completed', (run) => {
      this.pipeline('info', 'pipeline:completed', { runId: run.id });
    });
    bus.on('pipeline:failed', (run, error) => {
      this.pipeline('error', 'pipeline:failed', { runId: run.id, error: error.message });
    });
    bus.on('stage:started', (stage, run) => {
      this.pipeline('info', 'stage:started', { stage, runId: run.id });
      this.agent(stage, 'info', 'stage:started', {});
    });
    bus.on('stage:completed', (stage, run) => {
      this.pipeline('info', 'stage:completed', { stage, runId: run.id });
      this.agent(stage, 'info', 'stage:completed', {});
    });
    bus.on('stage:failed', (stage, run, error) => {
      this.pipeline('error', 'stage:failed', { stage, runId: run.id, error: error.message });
      this.agent(stage, 'error', 'stage:failed', { error: error.message });
    });
    bus.on('stage:awaiting_human', (stage) => {
      this.pipeline('info', 'stage:awaiting_human', { stage });
    });
    bus.on('stage:approved', (stage) => {
      this.pipeline('info', 'stage:approved', { stage });
    });
    bus.on('stage:rejected', (stage) => {
      this.pipeline('info', 'stage:rejected', { stage });
    });
    bus.on('agent:llm_call', (stage, duration) => {
      this.agent(stage, 'info', 'llm_call', { duration });
    });
    bus.on('agent:artifact_produced', (stage, artifact) => {
      this.agent(stage, 'info', 'artifact_produced', { artifact });
    });
  }

  pipeline(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.append(path.join(this.runDir, 'pipeline.log'), level, event, data);
  }

  agent(stage: StageName, level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.append(path.join(this.agentsDir, `${stage}.log`), level, event, data);
  }

  clarification(
    stage: StageName,
    questions: string[],
    answers?: string[],
  ): void {
    this.append(path.join(this.runDir, 'clarifications.log'), 'info', 'clarification', {
      stage,
      questions,
      answers,
    });
  }

  evolution(event: string, data?: Record<string, unknown>): void {
    this.append(path.join(this.runDir, 'evolution.log'), 'info', event, data);
  }

  private append(
    filePath: string,
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      data,
    };
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  }
}
