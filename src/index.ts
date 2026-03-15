import { Orchestrator } from './core/orchestrator.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: mosaicat <command> [options]');
    console.log('Commands:');
    console.log('  run <instruction> [--auto-approve]  Run the pipeline');
    console.log('  status                               Show pipeline status');
    console.log('  approve                              Approve current gate');
    console.log('  reject                               Reject current gate');
    process.exit(1);
  }

  const orchestrator = new Orchestrator('.');

  switch (command) {
    case 'run': {
      const autoApprove = args.includes('--auto-approve');
      const instruction = args
        .filter((a) => a !== 'run' && a !== '--auto-approve')
        .join(' ');

      if (!instruction) {
        console.error('Error: instruction is required');
        process.exit(1);
      }

      console.log(`Starting pipeline with instruction: "${instruction}"`);
      if (autoApprove) {
        console.log('Auto-approve mode enabled');
      }

      await orchestrator.run(instruction, autoApprove);
      break;
    }

    case 'status': {
      const status = orchestrator.getStatus();
      console.log(JSON.stringify(status, null, 2));
      break;
    }

    case 'approve': {
      orchestrator.approve();
      console.log('Gate approved');
      break;
    }

    case 'reject': {
      orchestrator.reject();
      console.log('Gate rejected');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
