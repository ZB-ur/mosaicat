import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { readArtifact, artifactExists, getArtifactsDir } from '../core/artifact.js';

const TESTER_PROMPT_PATH = '.claude/agents/mosaic/tester.md';

/** Per-module test generation timeout: 3 minutes */
const MODULE_TEST_TIMEOUT_MS = 180_000;

interface TestSuite {
  module: string;
  test_file: string;
  test_cases: Array<{ name: string; covers_tasks?: string[]; type?: string }>;
}

interface ModuleGroup {
  module: string;
  suites: TestSuite[];
  sourceFiles: string[];
  isIntegration: boolean;
}

/**
 * Tester Agent — generates and executes tests based on the test plan.
 *
 * Flow:
 * 1. Read test-plan.md and test-plan.manifest.json
 * 2. Group suites by module, resolve source files from code-plan.json
 * 3. Per-module LLM call: write test files with scoped source context
 * 4. Integration/E2E suites in a separate call with broader context
 * 5. Run test setup command (install test framework)
 * 6. Execute tests programmatically
 * 7. Collect results and generate test-report.md + test-report.manifest.json
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

    const suites: TestSuite[] = planManifest.test_suites ?? [];
    const codeDir = `${getArtifactsDir()}/code`;

    // Load module→files mapping from code-plan.json
    const moduleFileMap = this.loadModuleFileMap();

    // Group suites by module
    const groups = this.groupSuitesByModule(suites, moduleFileMap, codeDir);

    // Budget: 80% for generation, split across groups
    const genBudget = totalBudget * 0.8;
    const perGroupBudget = groups.length > 0 ? genBudget / groups.length : genBudget;

    // Step 1: Generate tests per module group
    const unitGroups = groups.filter(g => !g.isIntegration);
    const integrationGroups = groups.filter(g => g.isIntegration);

    for (let i = 0; i < unitGroups.length; i++) {
      const group = unitGroups[i];
      eventBus.emit('agent:progress', this.stage,
        `[${i + 1}/${unitGroups.length}] writing tests for "${group.module}" — ${group.suites.length} suite(s)`);
      try {
        await this.generateModuleTests(group, testPlan, planManifest, codeDir, perGroupBudget);
      } catch (err) {
        this.logger.agent(this.stage, 'warn', 'tester:module-failed', {
          module: group.module,
          error: err instanceof Error ? err.message : String(err),
        });
        eventBus.emit('agent:progress', this.stage,
          `[${i + 1}/${unitGroups.length}] "${group.module}" failed — continuing`);
      }
    }

    // Integration/E2E tests: broader context
    if (integrationGroups.length > 0) {
      eventBus.emit('agent:progress', this.stage,
        `writing integration/E2E tests — ${integrationGroups.length} group(s)`);
      const allSourceFiles = this.listFiles(codeDir);
      for (const group of integrationGroups) {
        group.sourceFiles = allSourceFiles;
        try {
          await this.generateModuleTests(group, testPlan, planManifest, codeDir, perGroupBudget * 1.5);
        } catch (err) {
          this.logger.agent(this.stage, 'warn', 'tester:integration-failed', {
            module: group.module,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Step 2: Run test setup
    this.runTestSetup(planManifest.commands?.setupCommand, codeDir);

    // Step 3: Execute tests
    const testResult = this.runTests(planManifest.commands?.runCommand, codeDir);

    // Step 4: Generate report
    this.generateReport(testResult, suites);
  }

  // ─── Module Grouping ──────────────────────────────────────

  /**
   * Load module→source files mapping from code-plan.json.
   */
  private loadModuleFileMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!artifactExists('code-plan.json')) return map;

    try {
      const plan = JSON.parse(readArtifact('code-plan.json'));
      for (const mod of plan.modules ?? []) {
        map.set(mod.name, mod.files ?? []);
      }
    } catch { /* ignore parse errors */ }

    return map;
  }

  /**
   * Group test suites by module. Detect integration/E2E suites.
   */
  private groupSuitesByModule(
    suites: TestSuite[],
    moduleFileMap: Map<string, string[]>,
    codeDir: string,
  ): ModuleGroup[] {
    const groupMap = new Map<string, ModuleGroup>();

    for (const suite of suites) {
      const isIntegration = this.isIntegrationSuite(suite);
      const key = isIntegration ? `__integration__${suite.module}` : suite.module;

      if (!groupMap.has(key)) {
        const sourceFiles = moduleFileMap.get(suite.module) ?? [];
        // Resolve to absolute paths for the prompt
        const resolvedFiles = sourceFiles
          .filter(f => !f.endsWith('.json') && !f.endsWith('.css'))
          .map(f => `${codeDir}/${f}`);

        groupMap.set(key, {
          module: suite.module,
          suites: [],
          sourceFiles: resolvedFiles,
          isIntegration,
        });
      }

      groupMap.get(key)!.suites.push(suite);
    }

    return [...groupMap.values()];
  }

  /**
   * Detect if a suite is integration/E2E based on test_file path or test case types.
   */
  private isIntegrationSuite(suite: TestSuite): boolean {
    const path = suite.test_file.toLowerCase();
    if (path.includes('e2e') || path.includes('integration') || path.includes('full-game')) {
      return true;
    }
    return suite.test_cases.some(tc => tc.type === 'e2e' || tc.type === 'integration');
  }

  // ─── Per-Module Test Generation ───────────────────────────

  private async generateModuleTests(
    group: ModuleGroup,
    testPlan: string,
    planManifest: Record<string, unknown>,
    codeDir: string,
    budgetUsd: number,
  ): Promise<void> {
    const testerPrompt = fs.readFileSync(TESTER_PROMPT_PATH, 'utf-8');

    const parts: string[] = [];
    parts.push(`## Task`);
    parts.push(`Write test files for module "${group.module}".`);
    parts.push('');

    // Slim suite info: only file path + test case names
    parts.push('## Test Suites to Write');
    for (const suite of group.suites) {
      parts.push(`### ${suite.test_file}`);
      parts.push(`Write to: ${codeDir}/${suite.test_file}`);
      parts.push('Test cases:');
      for (const tc of suite.test_cases) {
        parts.push(`- ${tc.name}`);
      }
      parts.push('');
    }

    // Test framework info (slim — just framework + commands)
    const framework = (planManifest as { test_framework?: string }).test_framework ?? 'vitest';
    parts.push(`## Test Framework: ${framework}`);
    parts.push('');

    // Scoped source files
    parts.push(`## Source Files to Read`);
    parts.push('Read these source files to understand what to test:');
    for (const f of group.sourceFiles.slice(0, 20)) {
      parts.push(`- ${f}`);
    }
    parts.push('');

    // Relevant section from test plan (extract by module name)
    const planSection = this.extractPlanSection(testPlan, group.module);
    if (planSection) {
      parts.push('## Test Plan (relevant section)');
      parts.push(planSection);
      parts.push('');
    }

    parts.push(`## Code Directory: ${codeDir}`);

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'tester:module-start', {
      module: group.module,
      suites: group.suites.length,
      sourceFiles: group.sourceFiles.length,
      promptLength: userPrompt.length,
      isIntegration: group.isIntegration,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: testerPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TEST_TIMEOUT_MS,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);

    this.logger.agent(this.stage, 'info', 'tester:module-complete', {
      module: group.module,
      responseLength: response.content.length,
    });
  }

  /**
   * Extract the section of test-plan.md relevant to a module.
   * Looks for headings containing the module name.
   */
  private extractPlanSection(testPlan: string, moduleName: string): string | null {
    const lines = testPlan.split('\n');
    let capturing = false;
    let depth = 0;
    const result: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);

      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].toLowerCase();

        if (title.includes(moduleName.toLowerCase())) {
          capturing = true;
          depth = level;
          result.push(line);
          continue;
        }

        // Stop when we hit same or higher level heading
        if (capturing && level <= depth) {
          break;
        }
      }

      if (capturing) {
        result.push(line);
      }
    }

    // Limit to ~3000 chars to keep prompt lean
    const section = result.join('\n');
    return section.length > 0 ? section.slice(0, 3000) : null;
  }

  // ─── Test Execution ───────────────────────────────────────

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
    let passed = 0, failed = 0, skipped = 0;

    const passMatch = output.match(/(\d+)\s+passed/i);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const skipMatch = output.match(/(\d+)\s+(?:skipped|pending|todo)/i);

    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);

    return { passed, failed, skipped };
  }

  // ─── Report Generation ────────────────────────────────────

  private generateReport(
    testResult: { success: boolean; output: string; passed: number; failed: number; skipped: number },
    suites: TestSuite[],
  ): void {
    const total = testResult.passed + testResult.failed + testResult.skipped;
    const verdict = testResult.failed === 0 && testResult.success ? 'pass' : 'fail';

    const failures = this.parseFailures(testResult.output, suites);

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
  ): Array<{ test_name: string; test_file: string; error: string; module: string }> {
    const failures: Array<{ test_name: string; test_file: string; error: string; module: string }> = [];

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

  // ─── File Helpers ─────────────────────────────────────────

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
