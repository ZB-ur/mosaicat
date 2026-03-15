import { Orchestrator } from './core/orchestrator.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'run') {
  const instruction = args[1];
  if (!instruction) {
    console.error('Usage: mosaicat run <instruction> [--auto-approve]');
    process.exit(1);
  }

  const autoApprove = args.includes('--auto-approve');
  const orchestrator = new Orchestrator();

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
  console.log('  mosaicat run <instruction> [--auto-approve]');
}
