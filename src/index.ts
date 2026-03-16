import { Orchestrator } from './core/orchestrator.js';
import { GitHubInteractionHandler } from './core/github-interaction-handler.js';
import { createGitHubAdapter } from './adapters/github.js';
import { loadSecurityConfig } from './core/security.js';
import { validateGitHubEnv } from './core/security.js';
import type { PipelineConfig } from './core/types.js';
import fs from 'node:fs';
import yaml from 'js-yaml';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'run') {
  const instruction = args[1];
  if (!instruction) {
    console.error('Usage: mosaicat run <instruction> [--auto-approve] [--github]');
    process.exit(1);
  }

  const autoApprove = args.includes('--auto-approve');
  const useGitHub = args.includes('--github');

  let orchestrator: Orchestrator;

  if (useGitHub) {
    const envCheck = validateGitHubEnv();
    if (!envCheck.valid) {
      console.error('[mosaicat] GitHub mode requires environment variables:');
      for (const err of envCheck.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    const pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;

    const adapter = createGitHubAdapter();
    const securityConfig = loadSecurityConfig(pipelineConfig);
    const handler = new GitHubInteractionHandler(adapter, pipelineConfig.github, securityConfig);
    orchestrator = new Orchestrator(handler, adapter);

    console.log('[mosaicat] GitHub mode enabled — approvals via Issue comments');
  } else {
    orchestrator = new Orchestrator();
  }

  console.log(`[mosaicat] Starting pipeline...`);
  console.log(`[mosaicat] Instruction: ${instruction}`);
  console.log(`[mosaicat] Auto-approve: ${autoApprove}`);
  console.log('');

  orchestrator
    .run(instruction, autoApprove)
    .then((result) => {
      console.log('');
      console.log(`[mosaicat] Pipeline complete!`);
      console.log(`[mosaicat] Run ID: ${result.id}`);
      console.log(`[mosaicat] Duration: ${new Date(result.completedAt!).getTime() - new Date(result.createdAt).getTime()}ms`);
      console.log(`[mosaicat] Artifacts: .mosaic/artifacts/`);
      console.log(`[mosaicat] Logs: .mosaic/logs/${result.id}/`);
    })
    .catch((err) => {
      console.error(`[mosaicat] Pipeline failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
} else {
  console.log('Usage:');
  console.log('  mosaicat run <instruction> [--auto-approve] [--github]');
}
