import type { PipelineRun } from './types.js';
import type { RunContext } from './run-context.js';
import type { StageExecutor } from './stage-executor.js';
import type { TestFailureCategory, ClassifiedFailure, FailureFingerprint } from './failure-classifier.js';
import { classifyTestOutput, createFingerprint, fingerprintsMatch, getDominantCategory } from './failure-classifier.js';
import { logRetry } from './retry-log.js';

export interface FixLoopConfig {
  maxRounds: number;       // default 5
  replanThreshold: number; // default 3
}

export interface FixStrategy {
  approach: 'direct-fix' | 'replan-failed-modules' | 'full-history-fix';
  direction: 'config-dependency' | 'logic' | 'environment';
}

const DEFAULT_FIX_LOOP_CONFIG: FixLoopConfig = {
  maxRounds: 5,
  replanThreshold: 3,
};

const DIRECTION_MAP: Record<TestFailureCategory, FixStrategy['direction']> = {
  'parse-import': 'config-dependency',
  'assertion': 'logic',
  'runtime': 'environment',
};

/**
 * Encapsulates the Tester-Coder fix loop with progressive strategy.
 * Runs independently of PipelineLoop index -- no index manipulation.
 *
 * Strategy (two dimensions):
 * - Round-based escalation: direct-fix (1-2) -> replan-failed-modules (3) -> full-history-fix (4-5)
 * - Classification-driven direction: parse-import -> config-dependency, assertion -> logic, runtime -> environment
 *
 * Stagnation detection: terminates early when identical failure sets repeat for 2 consecutive rounds.
 */
export class FixLoopRunner {
  private config: FixLoopConfig;
  private previousFingerprint: FailureFingerprint | null = null;
  private consecutiveMatchCount = 0;

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

      // Classify failures from test output (used for strategy + stagnation after execution)
      const { classifiedFailures, dominantCategory } = this.classifyCurrentFailures();

      round++;
      const strategy = this.selectApproach(round, dominantCategory);

      this.ctx.logger.pipeline('info', 'fix-loop:round', { round, approach: strategy.approach, direction: strategy.direction });
      this.ctx.eventBus.emit('coder:fix-round', round, 0, 0, strategy.approach, dominantCategory);

      // Log to retry-log with specific error category
      logRetry({
        timestamp: new Date().toISOString(),
        runId: pipelineRun.id,
        stage: 'tester',
        source: 'fix-loop-runner',
        attempt: round,
        errorCategory: dominantCategory === 'parse-import' ? 'parse-import'
          : dominantCategory === 'assertion' ? 'assertion'
          : 'runtime-error',
        errorMessage: `Fix loop round ${round}: ${strategy.approach} [${strategy.direction}]`,
        resolved: false,
      });

      // Record failure history
      try {
        const failureData = this.ctx.store.read('test-report.manifest.json');
        attemptHistory.push({ round, failures: failureData, approach: strategy.approach });
      } catch { /* non-fatal */ }

      // Inject test failures + cumulative history for coder
      this.injectTestFailuresForCoder(attemptHistory, classifiedFailures, strategy);

      // Reset coder and tester stages
      pipelineRun.stages['coder'] = { state: 'idle', retryCount: 0 };
      pipelineRun.stages['tester'] = { state: 'idle', retryCount: 0 };

      // Save state for crash recovery (save at start of round, not end)
      onStateSave(round);

      // Re-run coder then tester
      await this.executor.execute(pipelineRun, 'coder');
      await this.executor.execute(pipelineRun, 'tester');

      // After round execution: classify post-fix failures and check stagnation
      const postFix = this.classifyCurrentFailures();
      if (postFix.classifiedFailures.length > 0 && this.checkStagnation(postFix.classifiedFailures, round)) {
        const postStrategy = this.selectApproach(round, postFix.dominantCategory);
        this.ctx.logger.pipeline('warn', 'fix-loop:stagnation', {
          round,
          fingerprint: this.previousFingerprint?.hash?.slice(0, 80),
        });
        this.writeStagnationReport(postFix.classifiedFailures, round, postStrategy);
        return; // Terminate early
      }
    }

    // Log final summary
    const finalVerdict = this.checkTesterFailed() ? 'fail' : 'pass';
    this.ctx.logger.pipeline('info', 'fix-loop:complete', {
      totalRounds: round - startRound,
      finalVerdict,
    });
  }

  private classifyCurrentFailures(): { classifiedFailures: ClassifiedFailure[]; dominantCategory: TestFailureCategory } {
    let classifiedFailures: ClassifiedFailure[] = [];
    let dominantCategory: TestFailureCategory = 'runtime';
    try {
      const testReport = this.ctx.store.read('test-report.md');
      classifiedFailures = classifyTestOutput(testReport);
      dominantCategory = getDominantCategory(classifiedFailures);
    } catch { /* non-fatal -- use defaults */ }
    return { classifiedFailures, dominantCategory };
  }

  private selectApproach(round: number, dominantCategory: TestFailureCategory = 'runtime'): FixStrategy {
    let approach: FixStrategy['approach'];
    if (round < this.config.replanThreshold) approach = 'direct-fix';
    else if (round === this.config.replanThreshold) approach = 'replan-failed-modules';
    else approach = 'full-history-fix';

    return { approach, direction: DIRECTION_MAP[dominantCategory] };
  }

  private checkTesterFailed(): boolean {
    try {
      const manifest = JSON.parse(this.ctx.store.read('test-report.manifest.json'));
      return manifest?.verdict === 'fail';
    } catch {
      return false; // No manifest = no failure = don't loop
    }
  }

  private checkStagnation(currentFailures: ClassifiedFailure[], _round: number): boolean {
    const currentFp = createFingerprint(currentFailures);

    if (this.previousFingerprint && fingerprintsMatch(this.previousFingerprint, currentFp)) {
      this.consecutiveMatchCount++;
    } else {
      this.consecutiveMatchCount = 1;
    }
    this.previousFingerprint = currentFp;

    return this.consecutiveMatchCount >= 2; // D-02: 2 consecutive identical rounds
  }

  private writeStagnationReport(
    failures: ClassifiedFailure[],
    round: number,
    strategy: FixStrategy,
  ): void {
    const categoryCounts: Record<TestFailureCategory, number> = { 'parse-import': 0, 'assertion': 0, 'runtime': 0 };
    for (const f of failures) categoryCounts[f.category]++;

    const lines = [
      '# Stagnation Report',
      '',
      `**Detected at:** Round ${round}`,
      `**Identical failure set repeated:** Rounds ${round - 1} and ${round}`,
      '',
      '## Failed Tests',
      '| Test | Category | Error |',
      '|------|----------|-------|',
      ...failures.map(f => `| ${f.testName} | ${f.category} | ${f.errorSnippet.slice(0, 200).replace(/\|/g, '\\|')} |`),
      '',
      '## Classification Summary',
      `- parse-import: ${categoryCounts['parse-import']}`,
      `- assertion: ${categoryCounts['assertion']}`,
      `- runtime: ${categoryCounts['runtime']}`,
      '',
      '## Suggested Fix Direction',
      ...failures.map(f => {
        const dir = DIRECTION_MAP[f.category];
        const hint = dir === 'config-dependency'
          ? 'Check module paths and tsconfig path mappings. Likely a missing dependency or incorrect import path.'
          : dir === 'logic'
          ? 'Business logic mismatch. Review the implementation against the test expectations.'
          : 'Check test setup, teardown, environment variables, database connections.';
        return `- **${f.testName} (${f.category}):** ${hint}`;
      }),
    ];
    this.ctx.store.write('stagnation-report.md', lines.join('\n'));
  }

  private injectTestFailuresForCoder(
    attemptHistory: Array<{ round: number; failures: string; approach: string }>,
    classifiedFailures: ClassifiedFailure[],
    strategy: FixStrategy,
  ): void {
    try {
      const testReport = this.ctx.store.read('test-report.md');

      // Add classification context per D-06
      const classificationHeader = [
        '## Test Failure Analysis',
        '',
        `**Dominant error type:** ${getDominantCategory(classifiedFailures)}`,
        `**Fix direction:** ${strategy.direction}`,
        '',
        '## Failures by Category',
        ...classifiedFailures.map(f =>
          `- [${f.category}] ${f.testName}: ${f.errorSnippet.slice(0, 200)}`
        ),
        '',
        strategy.direction === 'config-dependency'
          ? '## Fix Focus: Config/Dependencies\nCheck import paths, missing packages, tsconfig settings, module resolution.'
          : strategy.direction === 'logic'
          ? '## Fix Focus: Logic\nReview the implementation logic. Tests expect different behavior than what the code produces.'
          : '## Fix Focus: Environment/Setup\nCheck test setup, teardown, environment variables, database connections.',
        '',
        '---',
        '',
      ].join('\n');

      this.ctx.store.write('test-failures-for-coder.md', classificationHeader + testReport);
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
