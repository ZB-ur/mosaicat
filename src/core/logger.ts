import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from './types.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private logDir: string;
  private streams = new Map<string, fs.WriteStream>();

  constructor(runId: string, baseDir = '.mosaic/logs') {
    this.logDir = path.join(baseDir, runId);
    fs.mkdirSync(path.join(this.logDir, 'agents'), { recursive: true });
  }

  pipeline(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.write('pipeline.log', level, event, data);
  }

  agent(stage: StageName, level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.write(`agents/${stage}.log`, level, event, data);
  }

  private write(file: string, level: LogLevel, event: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(data !== undefined ? { data } : {}),
    };
    const stream = this.getStream(file);
    stream.write(JSON.stringify(entry) + '\n');
  }

  private getStream(file: string): fs.WriteStream {
    let stream = this.streams.get(file);
    if (!stream) {
      const filePath = path.join(this.logDir, file);
      stream = fs.createWriteStream(filePath, { flags: 'a' });
      // Suppress ENOENT errors when log directory is cleaned up (e.g. test teardown)
      stream.on('error', () => {});
      this.streams.set(file, stream);
    }
    return stream;
  }

  async close(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const stream of this.streams.values()) {
      promises.push(new Promise((resolve) => stream.end(resolve)));
    }
    await Promise.all(promises);
    this.streams.clear();
  }

  getLogDir(): string {
    return this.logDir;
  }
}
