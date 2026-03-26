import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import type { CodePlan } from '../code-plan-schema.js';
import type { SmokeRunnerDeps } from './types.js';

/** Smoke test timeout: 15 seconds for server startup + request */
const SMOKE_TEST_TIMEOUT_MS = 15_000;
/** Placeholder keywords to scan for in smoke test response */
const PLACEHOLDER_KEYWORDS = ['Coming Soon', 'Placeholder', 'TODO:', 'Lorem ipsum'];
/** Minimum HTML length to consider non-empty */
const MIN_HTML_LENGTH = 500;

/**
 * SmokeRunner handles HTTP smoke tests for web projects.
 * Starts a server process, probes the port, and validates the response.
 * Extracted from CoderAgent.runSmokeTest() and waitForPort().
 */
export class SmokeRunner {
  constructor(private readonly deps: SmokeRunnerDeps) {}

  /**
   * Run HTTP smoke test for web projects.
   * Starts the preview server, fetches the page, checks for non-empty content.
   *
   * @param plan The code plan with smokeTest config
   * @param timeoutOverrideMs Optional timeout override (for testing)
   */
  async runSmokeTest(plan: CodePlan, timeoutOverrideMs?: number): Promise<void> {
    if (!plan.smokeTest || (plan.smokeTest.type !== 'web' && plan.smokeTest.type !== 'api')) {
      this.deps.logger.agent(this.deps.stage, 'info', 'smoke:skipped', {
        reason: plan.smokeTest ? `type is ${plan.smokeTest.type}` : 'no smokeTest config',
      });
      return;
    }

    const { startCommand, port, readyPattern } = plan.smokeTest;
    if (!port) {
      this.deps.logger.agent(this.deps.stage, 'info', 'smoke:skipped', { reason: 'no port configured' });
      return;
    }

    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    const timeout = timeoutOverrideMs ?? SMOKE_TEST_TIMEOUT_MS;
    this.deps.eventBus.emit('agent:progress', this.deps.stage, `smoke test: starting ${startCommand}...`);

    let proc: ChildProcess | undefined;
    try {
      // Start the preview server
      const [cmd, ...cmdArgs] = startCommand.split(' ');
      proc = spawn(cmd, cmdArgs, {
        cwd: codeDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      // Wait for port to be ready
      const ready = await this.waitForPort(port, timeout, readyPattern, proc);
      if (!ready) {
        this.deps.logger.agent(this.deps.stage, 'warn', 'smoke:timeout', {
          message: `Server did not start within ${timeout}ms`,
        });
        this.deps.eventBus.emit('agent:progress', this.deps.stage, 'smoke test: server timeout');
        return;
      }

      // Fetch the page
      const response = await fetch(`http://localhost:${port}`);
      const html = await response.text();

      const issues: string[] = [];

      // Check HTML length
      if (html.length < MIN_HTML_LENGTH) {
        issues.push(`HTML too short (${html.length} chars < ${MIN_HTML_LENGTH})`);
      }

      // Check for placeholder keywords
      for (const keyword of PLACEHOLDER_KEYWORDS) {
        if (html.includes(keyword)) {
          issues.push(`Placeholder keyword "${keyword}" in response`);
        }
      }

      if (issues.length === 0) {
        this.deps.logger.agent(this.deps.stage, 'info', 'smoke:passed', {
          htmlLength: html.length,
        });
        this.deps.eventBus.emit('agent:progress', this.deps.stage, `smoke test: passed (${html.length} chars)`);
      } else {
        this.deps.logger.agent(this.deps.stage, 'warn', 'smoke:issues', { issues });
        this.deps.eventBus.emit('agent:progress', this.deps.stage, `smoke test: ${issues.length} issue(s) — ${issues[0]}`);
      }
    } catch (err) {
      this.deps.logger.agent(this.deps.stage, 'warn', 'smoke:error', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.deps.eventBus.emit('agent:progress', this.deps.stage, 'smoke test: error — ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      // Kill the server process group
      if (proc?.pid) {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch { /* already dead */ }
      }
    }
  }

  /**
   * Wait for a TCP port to become available.
   * Optionally also checks stdout for a readyPattern.
   */
  waitForPort(
    port: number,
    timeoutMs: number,
    readyPattern?: string,
    proc?: ChildProcess,
  ): Promise<boolean> {
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
      if (readyPattern && proc?.stdout) {
        const regex = new RegExp(readyPattern);
        proc.stdout.on('data', (data: Buffer) => {
          if (regex.test(data.toString())) {
            done(true);
          }
        });
      }

      // Also handle process exit
      if (proc) {
        proc.on('exit', () => done(false));
      }

      // TCP poll
      const timer = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
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
        socket.connect(port, '127.0.0.1');
      }, 500);
    });
  }
}
