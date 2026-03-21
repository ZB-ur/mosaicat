import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { readArtifact, getArtifactsDir } from '../core/artifact.js';

const TESTER_PROMPT_PATH = '.claude/agents/mosaic/tester.md';

/** Per-suite timeout: 3 minutes */
const SUITE_TIMEOUT_MS = 180_000;

/**
 * Tester Agent — generates and executes tests based on the test plan.
 *
 * Flow:
 * 1. Read test-plan.md and test-plan.manifest.json
 * 2. For each test suite → call LLM with tool use to write test files
 * 3. Run test setup command (install test framework)
 * 4. Execute tests programmatically
 * 5. Collect results and generate test-report.md + test-report.manifest.json
 */
export class TesterAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['tests/', 'test-report.md'],
      manifest: 'test-report.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const autonomy = context.task.autonomy;
    const totalBudget = autonomy?.max_budget_usd ?? 3;

    // Read test plan manifest
    const planManifestRaw = context.inputArtifacts.get('test-plan.manifest.json')
      ?? readArtifact('test-plan.manifest.json');
    const planManifest = JSON.parse(planManifestRaw);

    const testPlan = context.inputArtifacts.get('test-plan.md')
      ?? readArtifact('test-plan.md');

    const suites = planManifest.test_suites ?? [];
    const perSuiteBudget = suites.length > 0 ? totalBudget / suites.length : totalBudget;

    // Step 1: Generate test files via LLM (all suites in one call for coherence)
    await this.generateTests(context, testPlan, planManifest, totalBudget * 0.8);

    // Step 2: Run test setup
    const codeDir = `${getArtifactsDir()}/code`;
    this.runTestSetup(planManifest.commands?.setupCommand, codeDir);

    // Step 3: Execute tests
    const testResult = this.runTests(planManifest.commands?.runCommand, codeDir);

    // Step 4: Generate report
    this.generateReport(testResult, suites);
  }

  private async generateTests(
    context: AgentContext,
    testPlan: string,
    planManifest: Record<string, unknown>,
    budgetUsd: number,
  ): Promise<void> {
    const testerPrompt = fs.readFileSync(TESTER_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;

    const parts: string[] = [];
    parts.push('## Task\nWrite test files based on the test plan.\n');
    parts.push(`## Test Plan\n${testPlan}\n`);
    parts.push(`## Test Plan Manifest\n\`\`\`json\n${JSON.stringify(planManifest, null, 2)}\n\`\`\`\n`);
    parts.push(`## Code Directory\nAll code is at: ${codeDir}/`);
    parts.push(`Write test files under: ${codeDir}/tests/\n`);

    // List existing code files for context
    const codeFiles = this.listFiles(codeDir);
    if (codeFiles.length > 0) {
      parts.push('## Existing Code Files');
      for (const f of codeFiles.slice(0, 50)) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'tester:generate-start', {
      promptLength: userPrompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: testerPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: SUITE_TIMEOUT_MS * 3,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);

    this.logger.agent(this.stage, 'info', 'tester:generate-complete', {
      responseLength: response.content.length,
    });
  }

  private runTestSetup(setupCommand: string | undefined, codeDir: string): void {
    if (!setupCommand) return;
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
    runCommand: string | undefined,
    codeDir: string,
  ): { success: boolean; output: string; passed: number; failed: number; skipped: number } {
    if (!runCommand) {
      return { success: false, output: 'No test run command specified', passed: 0, failed: 0, skipped: 0 };
    }

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
      return { success: false, output, ...counts };
    }
  }

  private parseTestCounts(output: string): { passed: number; failed: number; skipped: number } {
    // Try common test output patterns
    let passed = 0, failed = 0, skipped = 0;

    // vitest/jest pattern: "Tests: 5 passed, 2 failed, 1 skipped"
    const passMatch = output.match(/(\d+)\s+passed/i);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const skipMatch = output.match(/(\d+)\s+(?:skipped|pending|todo)/i);

    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);

    return { passed, failed, skipped };
  }

  private generateReport(
    testResult: { success: boolean; output: string; passed: number; failed: number; skipped: number },
    suites: Array<{ module: string; test_file: string; test_cases: Array<{ name: string }> }>,
  ): void {
    const total = testResult.passed + testResult.failed + testResult.skipped;
    const verdict = testResult.failed === 0 && testResult.success ? 'pass' : 'fail';

    // Parse individual failures from output
    const failures = this.parseFailures(testResult.output, suites);

    // Write test report markdown
    const reportLines: string[] = [
      '# Test Report',
      '',
      `## Summary`,
      `- **Total:** ${total}`,
      `- **Passed:** ${testResult.passed}`,
      `- **Failed:** ${testResult.failed}`,
      `- **Skipped:** ${testResult.skipped}`,
      `- **Verdict:** ${verdict.toUpperCase()}`,
      '',
    ];

    if (failures.length > 0) {
      reportLines.push('## Failures');
      reportLines.push('');
      for (const f of failures) {
        reportLines.push(`### ${f.test_name}`);
        reportLines.push(`- **File:** ${f.test_file}`);
        reportLines.push(`- **Module:** ${f.module}`);
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

    // Write manifest
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
    suites: Array<{ module: string; test_file: string; test_cases: Array<{ name: string }> }>,
  ): Array<{ test_name: string; test_file: string; error: string; module: string }> {
    const failures: Array<{ test_name: string; test_file: string; error: string; module: string }> = [];

    // Try to parse FAIL lines from vitest/jest output
    const failPattern = /FAIL\s+(.+?)(?:\n|$)/g;
    let match;
    while ((match = failPattern.exec(output)) !== null) {
      const failFile = match[1].trim();
      const suite = suites.find(s => failFile.includes(s.test_file) || s.test_file.includes(failFile));
      failures.push({
        test_name: failFile,
        test_file: suite?.test_file ?? failFile,
        error: 'Test failed (see raw output for details)',
        module: suite?.module ?? 'unknown',
      });
    }

    return failures;
  }

  private listFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      this.walkDir(dir, dir, files);
    } catch {
      // Directory may not exist
    }
    return files;
  }

  private walkDir(dir: string, baseDir: string, result: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        this.walkDir(fullPath, baseDir, result);
      } else {
        result.push(fullPath.slice(baseDir.length + 1));
      }
    }
  }
}
