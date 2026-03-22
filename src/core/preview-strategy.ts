import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

export interface PreviewStrategy {
  start(codeDir: string): Promise<{ url?: string }>;
  stop(): Promise<void>;
}

/**
 * Starts a web preview server (e.g., `npm run dev` or `npm run preview`).
 */
export class WebPreviewStrategy implements PreviewStrategy {
  private proc?: ChildProcess;
  private readonly startCommand: string;
  private readonly port: number;
  private readonly readyPattern?: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    startCommand: string;
    port: number;
    readyPattern?: string;
    timeoutMs?: number;
  }) {
    this.startCommand = opts.startCommand;
    this.port = opts.port;
    this.readyPattern = opts.readyPattern;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async start(codeDir: string): Promise<{ url?: string }> {
    const [cmd, ...args] = this.startCommand.split(' ');
    this.proc = spawn(cmd, args, {
      cwd: codeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const ready = await this.waitForPort();
    if (!ready) {
      return {};
    }

    const url = `http://localhost:${this.port}`;
    return { url };
  }

  async stop(): Promise<void> {
    if (this.proc?.pid) {
      try {
        process.kill(-this.proc.pid, 'SIGTERM');
      } catch { /* already dead */ }
    }
    this.proc = undefined;
  }

  private waitForPort(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const startTime = Date.now();
      let resolved = false;

      const done = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearInterval(timer);
          resolve(result);
        }
      };

      // Watch stdout for readyPattern
      if (this.readyPattern && this.proc?.stdout) {
        const regex = new RegExp(this.readyPattern);
        this.proc.stdout.on('data', (data: Buffer) => {
          if (regex.test(data.toString())) {
            done(true);
          }
        });
      }

      if (this.proc) {
        this.proc.on('exit', () => done(false));
      }

      // TCP poll
      const timer = setInterval(() => {
        if (Date.now() - startTime > this.timeoutMs) {
          done(false);
          return;
        }

        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.once('connect', () => {
          socket.destroy();
          done(true);
        });
        socket.once('error', () => socket.destroy());
        socket.once('timeout', () => socket.destroy());
        socket.connect(this.port, '127.0.0.1');
      }, 500);
    });
  }
}
