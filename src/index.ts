import { Orchestrator } from './core/orchestrator.js';
import { GitHubInteractionHandler } from './core/github-interaction-handler.js';
import { createGitHubAdapterFromAuth } from './adapters/github.js';
import { loadSecurityConfig } from './core/security.js';
import { attachCLIProgress } from './core/cli-progress.js';
import type { PipelineConfig } from './core/types.js';
import { resolveGitHubAuth } from './auth/resolve-auth.js';
import { oauthDeviceFlow } from './auth/oauth-device-flow.js';
import { saveCachedAuth, clearCachedAuth } from './auth/auth-store.js';
import fs from 'node:fs';
import yaml from 'js-yaml';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'login') {
  // ── OAuth Device Flow login ──
  console.log('[mosaicat] Starting GitHub login...');

  const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  const loginTimeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Login timed out after 10 minutes')),
      LOGIN_TIMEOUT_MS,
    );
    timer.unref(); // Don't block process exit
  });

  Promise.race([
    oauthDeviceFlow({
      onUserCode: (userCode, verificationUri) => {
        console.log(`\n! Paste this code in your browser: \x1b[1m${userCode}\x1b[0m`);
        console.log(`  → ${verificationUri}\n`);
        console.log('Waiting for authorization...');
      },
    }),
    loginTimeout,
  ])
    .then(({ accessToken, userLogin }) => {
      saveCachedAuth({ userToken: accessToken, userLogin });
      console.log(`\x1b[32m✓\x1b[0m Logged in as \x1b[1m@${userLogin}\x1b[0m`);
    })
    .catch((err) => {
      console.error(`\x1b[31m[mosaicat] Login failed: ${err instanceof Error ? err.message : err}\x1b[0m`);
      process.exit(1);
    });
} else if (command === 'logout') {
  // ── Clear cached auth ──
  clearCachedAuth();
  console.log('\x1b[32m✓\x1b[0m Logged out.');
} else if (command === 'setup') {
  // ── Interactive LLM provider setup ──
  import('./core/llm-setup.js').then(({ runSetup }) => runSetup()).catch((err) => {
    console.error(`\x1b[31m[mosaicat] Setup failed: ${err instanceof Error ? err.message : err}\x1b[0m`);
    process.exit(1);
  });
} else if (command === 'run') {
  const instruction = args[1];
  if (!instruction) {
    console.error('Usage: mosaicat run <instruction> [--auto-approve] [--github] [--evolve] [--profile <design-only|full|frontend-only>]');
    process.exit(1);
  }

  const autoApprove = args.includes('--auto-approve');
  const useGitHub = args.includes('--github');
  const useEvolve = args.includes('--evolve');
  const profileIdx = args.indexOf('--profile');
  const profileArg = profileIdx >= 0 ? args[profileIdx + 1] as import('./core/types.js').PipelineProfile | undefined : undefined;

  // Attach rich CLI progress output
  const detach = attachCLIProgress();

  const startRun = async () => {
    let orchestrator: Orchestrator;

    if (useGitHub) {
      const pipelineConfig = yaml.load(
        fs.readFileSync('config/pipeline.yaml', 'utf-8')
      ) as PipelineConfig;

      try {
        const authConfig = await resolveGitHubAuth();
        console.log(`[mosaicat] GitHub App mode — repo: ${authConfig.owner}/${authConfig.repo} (auto-detected)`);

        const adapter = createGitHubAdapterFromAuth(authConfig);
        await adapter.refreshToken();

        const securityConfig = loadSecurityConfig(pipelineConfig, authConfig.userLogin);
        const handler = new GitHubInteractionHandler(adapter, pipelineConfig.github, securityConfig);
        orchestrator = new Orchestrator(handler, adapter);
      } catch (err) {
        console.error(`\x1b[31m[mosaicat] GitHub auth failed: ${err instanceof Error ? err.message : err}\x1b[0m`);
        process.exit(1);
      }
    } else {
      orchestrator = new Orchestrator();
    }

    if (useEvolve) {
      orchestrator.enableEvolution();
      console.log('[mosaicat] Evolution mode enabled — proposals after pipeline completes');
    }

    console.log(`\x1b[2mInstruction: ${instruction}\x1b[0m`);
    console.log(`\x1b[2mAuto-approve: ${autoApprove}\x1b[0m`);
    if (profileArg) console.log(`\x1b[2mProfile: ${profileArg}\x1b[0m`);

    const result = await orchestrator.run(instruction, autoApprove, profileArg);

    console.log(`\x1b[2mRun ID: ${result.id}\x1b[0m`);
    console.log(`\x1b[2mArtifacts: .mosaic/artifacts/${result.id}/\x1b[0m`);
    console.log(`\x1b[2mLogs: .mosaic/logs/${result.id}/\x1b[0m`);
    detach();
  };

  startRun().catch((err) => {
    console.error(`\n\x1b[31m[mosaicat] Pipeline failed: ${err instanceof Error ? err.message : err}\x1b[0m`);
    detach();
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  mosaicat setup                                     # Configure LLM provider (interactive)');
  console.log('  mosaicat login                                     # One-time GitHub OAuth login');
  console.log('  mosaicat logout                                    # Clear saved credentials');
  console.log('  mosaicat run <instruction> [--auto-approve] [--github] [--evolve]');
}
