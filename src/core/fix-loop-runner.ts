import type { PipelineRun } from './types.js';
import type { RunContext } from './run-context.js';
import type { StageExecutor } from './stage-executor.js';
import { logRetry } from './retry-log.js';

export interface FixLoopConfig {
  maxRounds: number;       // default 5
  replanThreshold: number; // default 3
}

const DEFAULT_FIX_LOOP_CONFIG: FixLoopConfig = {
  maxRounds: 5,
  replanThreshold: 3,
};

/**
 * Encapsulates the Tester-Coder fix loop with progressive strategy.
 * Runs independently of PipelineLoop index -- no index manipulation.
 *
 * Strategy:
 * - Rounds 1-2: direct-fix (patch failing code)
 * - Round 3: replan-failed-modules (regenerate module plan)
 * - Rounds 4-5: full-history-fix (all context available)
 */
export class FixLoopRunner {
  private config: FixLoopConfig;

  constructor(
    private executor: StageExecutor,
    private ctx: RunContext,
    config?: Partial<FixLoopConfig>,
  ) {
    this.config = { ...DEFAULT_FIX_LOOP_CONFIG, ...config };
  }

  async run(
    pipelineRun: PipelineRun,
    onStateSave: (fixLoopRound: number) => void,
    startRound = 0,
  ): Promise<void> {
    let round = startRound;
    const attemptHistory: Array<{ round: number; failures: string; approach: string }> = [];

    while (round < this.config.maxRounds) {
      // Check if tester passed (verdict not fail)
      if (!this.checkTesterFailed()) {
        return; // Tests passed, exit fix loop
      }

      round++;
      const approach = this.selectApproach(round);

      this.ctx.logger.pipeline('info', 'fix-loop:round', { round, approach });
      this.ctx.eventBus.emit('coder:fix-round', round, 0, 0, approach);

      // Log to retry-log
      logRetry({
        timestamp: new Date().toISOString(),
        runId: pipelineRun.id,
        stage: 'tester',
        source: 'fix-loop-runner',
        attempt: round,
        errorCategory: 'test-failure',
        errorMessage: `Fix loop round ${round}: ${approach}`,
        resolved: false,
      });

      // Record failure history
      try {
        const failureData = this.ctx.store.read('test-report.manifest.json');
        attemptHistory.push({ round, failures: failureData, approach });
      } catch { /* non-fatal */ }

      // Inject test failures + cumulative history for coder
      this.injectTestFailuresForCoder(attemptHistory);

      // Reset coder and tester stages
      pipelineRun.stages['coder'] = { state: 'idle', retryCount: 0 };
      pipelineRun.stages['tester'] = { state: 'idle', retryCount: 0 };

      // Save state for crash recovery (save at start of round, not end)
      onStateSave(round);

      // Re-run coder then tester
      await this.executor.execute(pipelineRun, 'coder');
      await this.executor.execute(pipelineRun, 'tester');
    }

    // Log final summary
    const finalVerdict = this.checkTesterFailed() ? 'fail' : 'pass';
    this.ctx.logger.pipeline('info', 'fix-loop:complete', {
      totalRounds: round - startRound,
      finalVerdict,
    });
  }

  private selectApproach(round: number): string {
    if (round < this.config.replanThreshold) return 'direct-fix';
    if (round === this.config.replanThreshold) return 'replan-failed-modules';
    return 'full-history-fix';
  }

  private checkTesterFailed(): boolean {
    try {
      const manifest = JSON.parse(this.ctx.store.read('test-report.manifest.json'));
      return manifest?.verdict === 'fail';
    } catch {
      return false; // No manifest = no failure = don't loop
    }
  }

  private injectTestFailuresForCoder(
    attemptHistory: Array<{ round: number; failures: string; approach: string }>,
  ): void {
    try {
      const testReport = this.ctx.store.read('test-report.md');
      this.ctx.store.write('test-failures-for-coder.md', testReport);
    } catch { /* non-fatal */ }

    try {
      const historyStr = attemptHistory
        .map(h => `Round ${h.round} (${h.approach}): ${h.failures}`)
        .join('\n---\n');

      if (historyStr) {
        this.ctx.store.write('fix-attempt-history.md', historyStr);
      }
    } catch { /* non-fatal */ }
  }
}
