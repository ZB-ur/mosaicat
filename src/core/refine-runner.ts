import { execSync } from 'node:child_process';
import { input } from '@inquirer/prompts';
import { ArtifactStore } from './artifact-store.js';
import { createProvider } from './provider-factory.js';
import { Logger } from './logger.js';
import { EventBus } from './event-bus.js';
import { attachCLIProgress } from './cli-progress.js';
import { createRunContext } from './run-context.js';
import { WebPreviewStrategy, type PreviewStrategy } from './preview-strategy.js';
import { RefineAgent } from '../agents/refine-agent.js';
import { CodePlanSchema } from '../agents/code-plan-schema.js';
import type { AgentContext, Task } from './types.js';

/**
 * Run the refine loop: user feedback -> diagnose -> fix -> verify -> repeat.
 *
 * @param feedback - Initial user feedback
 * @param runId - Optional run ID; defaults to findLatestRun()
 */
export async function runRefine(feedback: string, runId?: string): Promise<void> {
  // Resolve target run
  const targetRun = runId ?? ArtifactStore.findLatestRun('.mosaic/artifacts');
  if (!targetRun) {
    process.stderr.write('\x1b[31m[mosaicat] No previous run found. Run `mosaicat run` first.\x1b[0m\n');
    process.exit(1);
  }

  // Create store for the target run
  const store = new ArtifactStore('.mosaic/artifacts', targetRun);
  process.stdout.write(`\x1b[2mRefining run: ${targetRun}\x1b[0m\n`);
  process.stdout.write(`\x1b[2mArtifacts: .mosaic/artifacts/${targetRun}/\x1b[0m\n`);

  const refineEventBus = new EventBus();
  const detach = attachCLIProgress(refineEventBus);
  const provider = createProvider();
  const logger = new Logger(`${targetRun}-refine`);

  const ctx = createRunContext({
    store,
    logger,
    provider,
    eventBus: refineEventBus,
    config: {
      stages: {},
      pipeline: { max_retries_per_stage: 3, snapshot: 'on_stage_complete' },
      security: { initiator: 'refine', reject_policy: 'silent' },
      github: { enabled: false, poll_interval_ms: 10000, poll_timeout_ms: 3600000, approve_keywords: ['/approve'], reject_keywords: ['/reject'] },
    },
    devMode: false,
  });

  // Load code-plan for commands and smoke test config
  let previewStrategy: PreviewStrategy | undefined;
  if (store.exists('code-plan.json')) {
    try {
      const plan = CodePlanSchema.parse(JSON.parse(store.read('code-plan.json')));
      if (plan.smokeTest?.type === 'web' && plan.smokeTest.port) {
        previewStrategy = new WebPreviewStrategy({
          startCommand: plan.smokeTest.startCommand,
          port: plan.smokeTest.port,
          readyPattern: plan.smokeTest.readyPattern,
        });
      }
    } catch {
      // No valid code-plan -- proceed without preview
    }
  }

  // Start dev server if available
  const codeDir = `${store.getDir()}/code`;
  if (previewStrategy) {
    process.stdout.write('\x1b[2mStarting dev server...\x1b[0m\n');
    const result = await previewStrategy.start(codeDir);
    if (result.url) {
      process.stdout.write(`\x1b[32mDev server running at ${result.url}\x1b[0m\n`);
      // Try to open in browser
      try {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        execSync(`${openCmd} ${result.url}`, { stdio: 'ignore' });
      } catch { /* browser open is best-effort */ }
    }
  }

  // Refine loop
  let currentFeedback = feedback;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Create agent with current feedback
      const agent = new RefineAgent(ctx);
      const context: AgentContext = {
        systemPrompt: '',
        task: {
          runId: targetRun,
          stage: 'coder',
          instruction: currentFeedback,
        } as Task,
        inputArtifacts: new Map([['user_feedback', currentFeedback]]),
      };

      await agent.execute(context);

      // Run verify + build
      if (store.exists('code-plan.json')) {
        try {
          const plan = CodePlanSchema.parse(JSON.parse(store.read('code-plan.json')));
          process.stdout.write(`\x1b[2mRunning verify: ${plan.commands.verifyCommand}\x1b[0m\n`);
          try {
            execSync(plan.commands.verifyCommand, { cwd: codeDir, timeout: 60_000, stdio: 'pipe' });
            process.stdout.write('\x1b[32mVerify passed\x1b[0m\n');
          } catch {
            process.stdout.write('\x1b[33mVerify failed (check output above)\x1b[0m\n');
          }

          process.stdout.write(`\x1b[2mRunning build: ${plan.commands.buildCommand}\x1b[0m\n`);
          try {
            execSync(plan.commands.buildCommand, { cwd: codeDir, timeout: 120_000, stdio: 'pipe' });
            process.stdout.write('\x1b[32mBuild passed\x1b[0m\n');
          } catch {
            process.stdout.write('\x1b[33mBuild failed (check output above)\x1b[0m\n');
          }

          // Run acceptance tests if they exist
          if (store.exists('test-plan.manifest.json')) {
            try {
              const testManifest = JSON.parse(store.read('test-plan.manifest.json'));
              const testCmd = testManifest.commands?.runCommand ?? 'npx vitest run tests/acceptance/';
              process.stdout.write(`\x1b[2mRunning acceptance tests: ${testCmd}\x1b[0m\n`);
              try {
                execSync(testCmd, { cwd: codeDir, timeout: 300_000, stdio: 'pipe' });
                process.stdout.write('\x1b[32mAcceptance tests passed\x1b[0m\n');
              } catch {
                process.stdout.write('\x1b[33mAcceptance tests failed (some tests may need further fixing)\x1b[0m\n');
              }
            } catch { /* manifest parse error */ }
          }
        } catch { /* plan parse error -- skip verification */ }
      }

      // Ask user for more feedback or done
      const nextFeedback = await input({
        message: 'More feedback (or "done" to finish):',
      });

      if (nextFeedback.toLowerCase().trim() === 'done' || nextFeedback.trim() === '') {
        process.stdout.write('\x1b[32mRefine complete.\x1b[0m\n');
        break;
      }

      currentFeedback = nextFeedback;
    }
  } finally {
    // Cleanup
    if (previewStrategy) {
      await previewStrategy.stop();
    }
    detach();
  }
}
