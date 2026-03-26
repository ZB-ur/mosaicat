import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';

interface TestSuite {
  module: string;
  test_file: string;
  test_cases: Array<{ name: string; covers_features?: string[]; covers_tasks?: string[]; type?: string }>;
}

/**
 * Tester Agent — Acceptance Test Executor
 *
 * The QALead has already written acceptance test code in code/tests/acceptance/.
 * The Tester's job is to:
 * 1. Install test dependencies
 * 2. Execute acceptance tests
 * 3. Analyze failures and map them back to F-NNN features
 * 4. Generate test-report.md + test-report.manifest.json
 */
export class TesterAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['test-report.md'],
      manifest: 'test-report.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    // Read test plan manifest for commands and suite info
    const planManifestRaw = context.inputArtifacts.get('test-plan.manifest.json')
      ?? (this.ctx.store.exists('test-plan.manifest.json') ? this.ctx.store.read('test-plan.manifest.json') : '{}');
    const planManifest = JSON.parse(planManifestRaw);

    const suites: TestSuite[] = planManifest.test_suites ?? [];
    const codeDir = `${this.ctx.store.getDir()}/code`;

    // Step 1: Install test dependencies
    const setupCommand = planManifest.commands?.setupCommand;
    if (setupCommand) {
      this.ctx.eventBus.emit('agent:progress', this.stage, `installing test dependencies`);
      this.runTestSetup(setupCommand, codeDir);
    }

    // Step 2: Execute acceptance tests
    this.ctx.eventBus.emit('agent:progress', this.stage, `executing acceptance tests`);
    const runCommand = planManifest.commands?.runCommand ?? 'npx vitest run tests/acceptance/';
    const testResult = this.runTests(runCommand, codeDir);

    // Step 3: Generate report with F-NNN mapping
    this.generateReport(testResult, suites);

    // Emit summary
    const total = testResult.passed + testResult.failed + testResult.skipped;
    const verdict = testResult.failed === 0 && testResult.success ? 'pass' : 'fail';
    this.ctx.eventBus.emit('agent:summary', this.stage,
      `${total} tests: ${testResult.passed} passed, ${testResult.failed} failed — ${verdict.toUpperCase()}`);
  }

  // --- Test Execution ---

  private runTestSetup(setupCommand: string, codeDir: string): void {
    try {
      this.logger.agent(this.stage, 'info', 'tester:setup', { command: setupCommand });
      execSync(setupCommand, { cwd: codeDir, timeout: 120_000, stdio: 'pipe' });
    } catch (err) {
      this.logger.agent(this.stage, 'warn', 'tester:setup-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private runTests(
    runCommand: string,
    codeDir: string,
  ): { success: boolean; output: string; passed: number; failed: number; skipped: number } {
    try {
      this.logger.agent(this.stage, 'info', 'tester:run', { command: runCommand });
      const output = execSync(runCommand, {
        cwd: codeDir,
        timeout: 300_000,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      const counts = this.parseTestCounts(output);
      return { success: true, output, ...counts };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
      const counts = this.parseTestCounts(output);
      // If tests ran but some failed, we have counts
      return { success: false, output, ...counts };
    }
  }

  private parseTestCounts(output: string): { passed: number; failed: number; skipped: number } {
    let passed = 0, failed = 0, skipped = 0;

    const passMatch = output.match(/(\d+)\s+passed/i);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const skipMatch = output.match(/(\d+)\s+(?:skipped|pending|todo)/i);

    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);

    return { passed, failed, skipped };
  }

  // --- Report Generation ---

  private generateReport(
    testResult: { success: boolean; output: string; passed: number; failed: number; skipped: number },
    suites: TestSuite[],
  ): void {
    const total = testResult.passed + testResult.failed + testResult.skipped;
    const verdict = testResult.failed === 0 && testResult.success ? 'pass' : 'fail';

    const failures = this.parseFailures(testResult.output, suites);

    // Build feature coverage table
    const featureCoverage = this.buildFeatureCoverage(suites, failures);

    const reportLines: string[] = [
      '# Test Report',
      '',
      '## Summary',
      `- **Verdict:** ${verdict.toUpperCase()}`,
      `- **Total:** ${total}`,
      `- **Passed:** ${testResult.passed}`,
      `- **Failed:** ${testResult.failed}`,
      `- **Skipped:** ${testResult.skipped}`,
      '',
    ];

    // Feature coverage table
    if (featureCoverage.length > 0) {
      reportLines.push('## Feature Coverage');
      reportLines.push('| F-NNN | Tests | Passed | Failed |');
      reportLines.push('|-------|-------|--------|--------|');
      for (const fc of featureCoverage) {
        reportLines.push(`| ${fc.feature} | ${fc.total} | ${fc.passed} | ${fc.failed} |`);
      }
      reportLines.push('');
    }

    if (failures.length > 0) {
      reportLines.push('## Failures');
      reportLines.push('');
      for (const f of failures) {
        reportLines.push(`### ${f.test_name}`);
        reportLines.push(`- **File:** ${f.test_file}`);
        reportLines.push(`- **Module:** ${f.module}`);
        if (f.covers_features?.length) {
          reportLines.push(`- **Features:** ${f.covers_features.join(', ')}`);
        }
        reportLines.push(`- **Error:** ${f.error}`);
        reportLines.push('');
      }
    }

    if (testResult.output) {
      reportLines.push('## Raw Output');
      reportLines.push('```');
      reportLines.push(testResult.output.slice(0, 5000));
      reportLines.push('```');
    }

    this.writeOutput('test-report.md', reportLines.join('\n'));

    const manifest = {
      total,
      passed: testResult.passed,
      failed: testResult.failed,
      skipped: testResult.skipped,
      failures,
      verdict,
    };
    this.writeOutputManifest('test-report.manifest.json', manifest);

    this.logger.agent(this.stage, 'info', 'tester:report', {
      total,
      passed: testResult.passed,
      failed: testResult.failed,
      verdict,
    });
  }

  private parseFailures(
    output: string,
    suites: TestSuite[],
  ): Array<{ test_name: string; test_file: string; error: string; module: string; covers_features?: string[] }> {
    const failures: Array<{ test_name: string; test_file: string; error: string; module: string; covers_features?: string[] }> = [];

    // Match vitest FAIL lines
    const failPattern = /FAIL\s+(.+?)(?:\n|$)/g;
    let match;
    while ((match = failPattern.exec(output)) !== null) {
      const failFile = match[1].trim();
      const suite = suites.find(s => failFile.includes(s.test_file) || s.test_file.includes(failFile));

      // Extract features from the suite's test cases
      const features = suite?.test_cases
        ?.flatMap(tc => tc.covers_features ?? [])
        .filter((v, i, arr) => arr.indexOf(v) === i) ?? [];

      failures.push({
        test_name: failFile,
        test_file: suite?.test_file ?? failFile,
        error: 'Test failed (see raw output for details)',
        module: suite?.module ?? 'unknown',
        covers_features: features.length > 0 ? features : undefined,
      });
    }

    return failures;
  }

  private buildFeatureCoverage(
    suites: TestSuite[],
    failures: Array<{ covers_features?: string[] }>,
  ): Array<{ feature: string; total: number; passed: number; failed: number }> {
    const featureMap = new Map<string, { total: number; failed: number }>();

    // Count total tests per feature from suites
    for (const suite of suites) {
      for (const tc of suite.test_cases) {
        for (const feat of tc.covers_features ?? []) {
          const entry = featureMap.get(feat) ?? { total: 0, failed: 0 };
          entry.total++;
          featureMap.set(feat, entry);
        }
      }
    }

    // Count failures per feature
    const failedFeatures = new Set<string>();
    for (const f of failures) {
      for (const feat of f.covers_features ?? []) {
        failedFeatures.add(feat);
      }
    }

    // Build coverage array
    const coverage: Array<{ feature: string; total: number; passed: number; failed: number }> = [];
    for (const [feature, counts] of featureMap) {
      const failed = failedFeatures.has(feature) ? 1 : 0; // Approximate
      coverage.push({
        feature,
        total: counts.total,
        passed: counts.total - failed,
        failed,
      });
    }

    return coverage.sort((a, b) => a.feature.localeCompare(b.feature));
  }
}
