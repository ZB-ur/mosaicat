import { execSync } from 'node:child_process';
import { input } from '@inquirer/prompts';
import { initArtifactsDir, findLatestRun, artifactExists, readArtifact, getArtifactsDir } from './artifact.js';
import { createProvider } from './provider-factory.js';
import { Logger } from './logger.js';
import { attachCLIProgress } from './cli-progress.js';
import { WebPreviewStrategy, type PreviewStrategy } from './preview-strategy.js';
import { RefineAgent } from '../agents/refine-agent.js';
import { CodePlanSchema } from '../agents/code-plan-schema.js';
import type { AgentContext, Task } from './types.js';

/**
 * Run the refine loop: user feedback → diagnose → fix → verify → repeat.
 *
 * @param feedback - Initial user feedback
 * @param runId - Optional run ID; defaults to findLatestRun()
 */
export async function runRefine(feedback: string, runId?: string): Promise<void> {
  // Resolve target run
  const targetRun = runId ?? findLatestRun();
  if (!targetRun) {
    console.error('\x1b[31m[mosaicat] No previous run found. Run `mosaicat run` first.\x1b[0m');
    process.exit(1);
  }

  // Point artifact system at the target run
  initArtifactsDir(targetRun);
  console.log(`\x1b[2mRefining run: ${targetRun}\x1b[0m`);
  console.log(`\x1b[2mArtifacts: .mosaic/artifacts/${targetRun}/\x1b[0m`);

  const detach = attachCLIProgress();
  const provider = createProvider();
  const logger = new Logger(`${targetRun}-refine`);

  // Load code-plan for commands and smoke test config
  let previewStrategy: PreviewStrategy | undefined;
  if (artifactExists('code-plan.json')) {
    try {
      const plan = CodePlanSchema.parse(JSON.parse(readArtifact('code-plan.json')));
      if (plan.smokeTest?.type === 'web' && plan.smokeTest.port) {
        previewStrategy = new WebPreviewStrategy({
          startCommand: plan.smokeTest.startCommand,
          port: plan.smokeTest.port,
          readyPattern: plan.smokeTest.readyPattern,
        });
      }
    } catch {
      // No valid code-plan — proceed without preview
    }
  }

  // Start dev server if available
  const codeDir = `${getArtifactsDir()}/code`;
  if (previewStrategy) {
    console.log('\x1b[2mStarting dev server...\x1b[0m');
    const result = await previewStrategy.start(codeDir);
    if (result.url) {
      console.log(`\x1b[32mDev server running at ${result.url}\x1b[0m`);
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
      const agent = new RefineAgent(provider, logger);
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
      if (artifactExists('code-plan.json')) {
        try {
          const plan = CodePlanSchema.parse(JSON.parse(readArtifact('code-plan.json')));
          console.log(`\x1b[2mRunning verify: ${plan.commands.verifyCommand}\x1b[0m`);
          try {
            execSync(plan.commands.verifyCommand, { cwd: codeDir, timeout: 60_000, stdio: 'pipe' });
            console.log('\x1b[32mVerify passed\x1b[0m');
          } catch {
            console.log('\x1b[33mVerify failed (check output above)\x1b[0m');
          }

          console.log(`\x1b[2mRunning build: ${plan.commands.buildCommand}\x1b[0m`);
          try {
            execSync(plan.commands.buildCommand, { cwd: codeDir, timeout: 120_000, stdio: 'pipe' });
            console.log('\x1b[32mBuild passed\x1b[0m');
          } catch {
            console.log('\x1b[33mBuild failed (check output above)\x1b[0m');
          }

          // Run acceptance tests if they exist
          if (artifactExists('test-plan.manifest.json')) {
            try {
              const testManifest = JSON.parse(readArtifact('test-plan.manifest.json'));
              const testCmd = testManifest.commands?.runCommand ?? 'npx vitest run tests/acceptance/';
              console.log(`\x1b[2mRunning acceptance tests: ${testCmd}\x1b[0m`);
              try {
                execSync(testCmd, { cwd: codeDir, timeout: 300_000, stdio: 'pipe' });
                console.log('\x1b[32mAcceptance tests passed\x1b[0m');
              } catch {
                console.log('\x1b[33mAcceptance tests failed (some tests may need further fixing)\x1b[0m');
              }
            } catch { /* manifest parse error */ }
          }
        } catch { /* plan parse error — skip verification */ }
      }

      // Ask user for more feedback or done
      const nextFeedback = await input({
        message: 'More feedback (or "done" to finish):',
      });

      if (nextFeedback.toLowerCase().trim() === 'done' || nextFeedback.trim() === '') {
        console.log('\x1b[32mRefine complete.\x1b[0m');
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
