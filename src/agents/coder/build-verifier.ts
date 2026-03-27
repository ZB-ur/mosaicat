import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../../core/types.js';
import type { CodePlan } from '../code-plan-schema.js';
import type { BuildVerifierDeps } from './types.js';
import { BUILDER_PROMPT_PATH } from './coder-builder.js';
import { listBuiltFiles } from './utils.js';
import { logRetry } from '../../core/retry-log.js';

/** Number of automatic fix retries before asking user confirmation */
export const AUTO_FIX_RETRIES = 3;
/** Build fix timeout: 10 minutes */
const BUILD_FIX_TIMEOUT_MS = 600_000;
/** Per-module implement timeout: 5 minutes */
const MODULE_TIMEOUT_MS = 300_000;
/** Placeholder keywords to scan for in build output */
const PLACEHOLDER_KEYWORDS = ['Coming Soon', 'Placeholder', 'TODO:', 'Lorem ipsum'];
/** Minimum JS bundle size to consider valid */
const MIN_BUNDLE_SIZE_BYTES = 10_000;
/** Minimum HTML length to consider non-empty */
const MIN_HTML_LENGTH = 500;

/**
 * BuildVerifier handles compilation checks, build-fix loops, and acceptance tests.
 * Extracted from CoderAgent shell command and build verification methods.
 */
export class BuildVerifier {
  constructor(private readonly deps: BuildVerifierDeps) {}

  // ─── Shell Commands ──────────────────────────────────────

  /**
   * Run the project setup command (e.g., npm install).
   * Logs warning on failure but never throws.
   */
  runSetupCommand(plan: CodePlan): void {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    try {
      this.deps.logger.agent(this.deps.stage, 'info', 'cmd:setup', { command: plan.commands.setupCommand });
      execSync(plan.commands.setupCommand, {
        cwd: codeDir,
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch (err) {
      this.deps.logger.agent(this.deps.stage, 'warn', 'cmd:setup-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Run the project verify command (e.g., tsc --noEmit).
   * Returns success/failure with error text.
   */
  runVerifyCommand(plan: CodePlan): { success: boolean; errors: string } {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    try {
      execSync(plan.commands.verifyCommand, {
        cwd: codeDir,
        timeout: 60_000,
        stdio: 'pipe',
      });
      return { success: true, errors: '' };
    } catch (err: unknown) {
      const error = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const stdout = error.stdout?.toString() ?? '';
      const stderr = error.stderr?.toString() ?? '';
      return { success: false, errors: `${stdout}\n${stderr}`.trim() || error.message || 'Unknown error' };
    }
  }

  /**
   * Run the project build command (e.g., npm run build).
   * Returns success/failure with error text.
   */
  runBuildCommand(plan: CodePlan): { success: boolean; errors: string } {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    try {
      execSync(plan.commands.buildCommand, {
        cwd: codeDir,
        timeout: 120_000,
        stdio: 'pipe',
      });
      return { success: true, errors: '' };
    } catch (err: unknown) {
      const error = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const stdout = error.stdout?.toString() ?? '';
      const stderr = error.stderr?.toString() ?? '';
      return { success: false, errors: `${stdout}\n${stderr}`.trim() || error.message || 'Unknown error' };
    }
  }

  // ─── Error Extraction ──────────────────────────────────

  /**
   * Extract file paths from compilation error output.
   * Supports TypeScript and bundler error formats.
   */
  extractErrorFiles(errors: string): string[] {
    const files = new Set<string>();
    const tsPattern = /^([^\s(]+\.tsx?)\(\d+,\d+\)/gm;
    const bundlerPattern = /(?:ERROR|error)\s+(?:in\s+)?\.?\/?([^\s:]+\.(?:ts|tsx|js|jsx))/gm;

    let match;
    while ((match = tsPattern.exec(errors)) !== null) {
      files.add(match[1]);
    }
    while ((match = bundlerPattern.exec(errors)) !== null) {
      files.add(match[1]);
    }

    return [...files];
  }

  // ─── Build Fix ─────────────────────────────────────────

  /**
   * Run LLM-assisted build fix for final build failures.
   */
  async runBuildFix(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    const builtFiles = listBuiltFiles(codeDir);

    const prompt = [
      '## Build Fix',
      `The final build command (\`${plan.commands.buildCommand}\`) failed.`,
      `Working directory: ${codeDir}`,
      '',
      '## Build Errors',
      '```',
      errors,
      '```',
      '',
      '## Project Files',
      ...builtFiles.map(f => `- ${f}`),
      '',
      'Fix the build errors. Only modify files that need fixing.',
    ].join('\n');

    this.deps.logger.agent(this.deps.stage, 'info', 'build:fix-start', {});

    await this.deps.provider.call(prompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: BUILD_FIX_TIMEOUT_MS,
    });

    this.deps.logger.agent(this.deps.stage, 'info', 'build:fix-complete', {});
  }

  // ─── Build Artifact Analysis ───────────────────────────

  /**
   * Analyze build output for quality signals (zero LLM cost).
   * Checks: dist/ exists, bundle size, placeholder keywords, HTML references.
   */
  analyzeBuildArtifacts(plan: CodePlan): void {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    const distDir = `${codeDir}/dist`;
    const warnings: string[] = [];

    // Check 1: dist/ exists and is non-empty
    if (!fs.existsSync(distDir)) {
      warnings.push('dist/ directory does not exist after build');
      this.logAnalysisResult(warnings);
      return;
    }

    const distFiles = listBuiltFiles(distDir);
    if (distFiles.length === 0) {
      warnings.push('dist/ directory is empty');
      this.logAnalysisResult(warnings);
      return;
    }

    // Check 2: JS bundle total size
    const jsFiles = distFiles.filter(f => f.endsWith('.js'));
    let totalJsSize = 0;
    for (const f of jsFiles) {
      try {
        totalJsSize += fs.statSync(`${distDir}/${f}`).size;
      } catch { /* skip */ }
    }
    if (totalJsSize < MIN_BUNDLE_SIZE_BYTES) {
      warnings.push(`JS bundle total size is ${totalJsSize} bytes (< ${MIN_BUNDLE_SIZE_BYTES} minimum)`);
    }

    // Check 3: Scan bundles for placeholder keywords
    for (const f of jsFiles) {
      try {
        const content = fs.readFileSync(`${distDir}/${f}`, 'utf-8');
        for (const keyword of PLACEHOLDER_KEYWORDS) {
          if (content.includes(keyword)) {
            warnings.push(`Placeholder keyword "${keyword}" found in ${f}`);
          }
        }
      } catch { /* skip */ }
    }

    // Check 4: index.html references JS/CSS bundles
    const indexHtmlPath = `${distDir}/index.html`;
    if (fs.existsSync(indexHtmlPath)) {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      if (!html.includes('.js')) {
        warnings.push('index.html does not reference any JS bundle');
      }
      if (!html.includes('.css') && !html.includes('style')) {
        warnings.push('index.html does not reference any CSS');
      }
    } else {
      warnings.push('dist/index.html not found');
    }

    this.logAnalysisResult(warnings);
  }

  private logAnalysisResult(warnings: string[]): void {
    if (warnings.length === 0) {
      this.deps.logger.agent(this.deps.stage, 'info', 'analysis:passed', {
        message: 'Build artifact analysis passed — no warnings',
      });
      this.deps.eventBus.emit('agent:progress', this.deps.stage, 'build analysis: passed');
    } else {
      this.deps.logger.agent(this.deps.stage, 'warn', 'analysis:warnings', { warnings });
      this.deps.eventBus.emit('agent:progress', this.deps.stage, `build analysis: ${warnings.length} warning(s) — ${warnings[0]}`);
    }
  }

  // ─── User Confirmation ────────────────────────────────

  /**
   * Ask user whether to retry a failing module.
   * Returns false if no InteractionHandler is available.
   */
  async askUserToRetry(moduleName: string, attempts: number, errors: string): Promise<boolean> {
    if (!this.deps.interactionHandler) {
      return false;
    }

    const errorPreview = errors.slice(0, 500);
    const answer = await this.deps.interactionHandler.onClarification(
      this.deps.stage,
      `Module "${moduleName}" still has compilation errors after ${attempts} fix attempts.\n\nErrors:\n${errorPreview}\n\nContinue retrying?`,
      '',
      [
        { label: 'Retry', description: 'Try fixing again' },
        { label: 'Skip', description: 'Skip this module and continue' },
      ],
      false,
    );

    return answer.toLowerCase().includes('retry');
  }

  // ─── Acceptance Tests ─────────────────────────────────

  /**
   * Run acceptance tests written by QALead (if they exist).
   * On failure: attempt fix cycles with escalating strategies.
   */
  async runAcceptanceTests(
    context: AgentContext,
    plan: CodePlan,
    fixBudgetUsd: number,
  ): Promise<void> {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    const testsDir = `${codeDir}/tests/acceptance`;

    // Check if acceptance tests exist (tests live inside code/ project directory)
    if (!fs.existsSync(testsDir)) {
      this.deps.logger.agent(this.deps.stage, 'info', 'acceptance:skipped', {
        reason: 'no code/tests/acceptance/ directory',
      });
      return;
    }

    // Install test dependencies if test plan exists
    try {
      const testPlanManifest = this.deps.artifacts.read('test-plan.manifest.json');
      const manifest = JSON.parse(testPlanManifest);
      if (manifest.commands?.setupCommand) {
        this.deps.eventBus.emit('agent:progress', this.deps.stage, 'acceptance: installing test deps');
        try {
          execSync(manifest.commands.setupCommand, {
            cwd: codeDir,
            timeout: 120_000,
            stdio: 'pipe',
          });
        } catch { /* non-fatal */ }
      }
    } catch { /* no manifest */ }

    const MAX_ACCEPTANCE_FIX_ROUNDS = 3;
    const perRoundBudget = fixBudgetUsd / MAX_ACCEPTANCE_FIX_ROUNDS;

    for (let round = 1; round <= MAX_ACCEPTANCE_FIX_ROUNDS; round++) {
      const result = this.executeAcceptanceTests(codeDir);

      this.deps.eventBus.emit('coder:fix-round', round, result.total, result.passed,
        round === 1 ? 'initial run' : `fix attempt ${round - 1}`);

      if (result.passed === result.total) {
        this.deps.eventBus.emit('agent:progress', this.deps.stage, `acceptance: all ${result.total} tests passed`);
        this.deps.logger.agent(this.deps.stage, 'info', 'acceptance:passed', {
          total: result.total,
          passed: result.passed,
          rounds: round,
        });
        return;
      }

      if (round >= MAX_ACCEPTANCE_FIX_ROUNDS) {
        this.deps.eventBus.emit('agent:progress', this.deps.stage, `acceptance: ${result.passed}/${result.total} passed after ${round} rounds`);
        this.deps.logger.agent(this.deps.stage, 'warn', 'acceptance:partial', {
          total: result.total,
          passed: result.passed,
          failed: result.failed,
          rounds: round,
        });
        return;
      }

      // Fix: send failures to builder for targeted fix
      this.deps.eventBus.emit('agent:progress', this.deps.stage, `acceptance: ${result.failed} failed — fix round ${round}...`);

      logRetry({
        timestamp: new Date().toISOString(),
        runId: context.task.runId,
        stage: this.deps.stage,
        source: 'coder-acceptance-fix',
        attempt: round,
        errorCategory: 'test-failure',
        errorMessage: result.errors,
        resolved: false,
      });

      await this.fixAcceptanceFailures(context, plan, result.errors, perRoundBudget);
    }
  }

  /**
   * Execute acceptance tests and parse results.
   */
  private executeAcceptanceTests(codeDir: string): {
    total: number;
    passed: number;
    failed: number;
    errors: string;
  } {
    try {
      const output = execSync('npx vitest run tests/acceptance/ --reporter=verbose 2>&1 || true', {
        cwd: codeDir,
        timeout: 120_000,
        encoding: 'utf-8',
      });

      // Parse vitest output for pass/fail counts
      const passMatch = output.match(/(\d+)\s+passed/);
      const failMatch = output.match(/(\d+)\s+failed/);
      const totalMatch = output.match(/Tests\s+(\d+)/);

      const passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : 0;
      const total = totalMatch ? parseInt(totalMatch[1]) : passed + failed;

      return { total, passed, failed, errors: failed > 0 ? output : '' };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = (error.stdout ?? '') + '\n' + (error.stderr ?? '');
      return { total: 0, passed: 0, failed: 0, errors: output || error.message || 'Unknown error' };
    }
  }

  /**
   * Fix acceptance test failures via LLM.
   */
  private async fixAcceptanceFailures(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${this.deps.artifacts.getDir()}/code`;

    const prompt = [
      '## Fix Acceptance Test Failures',
      `Working directory: ${codeDir}`,
      '',
      '## Test Output',
      '```',
      errors.slice(0, 4000),
      '```',
      '',
      '## Instructions',
      '1. Read the failing test files to understand what behavior is expected',
      '2. Read the corresponding source files',
      '3. Fix the source code to make the tests pass',
      '4. Do NOT modify the test files — only fix the source code',
      '5. Preserve all existing imports, exports, and type signatures',
    ].join('\n');

    await this.deps.provider.call(prompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });
  }
}
