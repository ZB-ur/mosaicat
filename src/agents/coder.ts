import fs from 'node:fs';
import net from 'node:net';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import type { AgentContext, StageName } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { InteractionHandler } from '../core/interaction-handler.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { readArtifact, artifactExists, getArtifactsDir } from '../core/artifact.js';
import { CodePlanSchema, type CodePlan, type CodePlanModule } from './code-plan-schema.js';
import { logRetry, classifyError } from '../core/retry-log.js';

const PLANNER_PROMPT_PATH = '.claude/agents/mosaic/code-planner.md';
const BUILDER_PROMPT_PATH = '.claude/agents/mosaic/code-builder.md';
const SKELETON_PROMPT_PATH = '.claude/agents/mosaic/code-skeleton.md';

/** Planner budget */
const PLANNER_BUDGET_USD = 0.50;
/** Skeleton phase: 10 min — writes all files */
const SKELETON_TIMEOUT_MS = 600_000;
/** Skeleton budget */
const SKELETON_BUDGET_USD = 2.00;
/** Per-module implement timeout: 5 minutes */
const MODULE_TIMEOUT_MS = 300_000;
/** Build fix timeout: 10 minutes */
const BUILD_FIX_TIMEOUT_MS = 600_000;
/** Number of automatic fix retries before asking user confirmation */
const AUTO_FIX_RETRIES = 3;
/** Smoke test timeout: 15 seconds for server startup + request */
const SMOKE_TEST_TIMEOUT_MS = 15_000;
/** Placeholder keywords to scan for in build output */
const PLACEHOLDER_KEYWORDS = ['Coming Soon', 'Placeholder', 'TODO:', 'Lorem ipsum'];
/** Minimum JS bundle size to consider valid */
const MIN_BUNDLE_SIZE_BYTES = 10_000;
/** Minimum HTML length to consider non-empty */
const MIN_HTML_LENGTH = 500;

/**
 * High-autonomy Coder Agent with skeleton-implement architecture.
 *
 * Flow:
 * 1. Get or create code-plan.json (planner, no tool use)
 * 2. Skeleton phase (1 LLM call + tool use) — writes all files with real
 *    imports/exports/routes but stub implementations
 * 3. npm install
 * 4. tsc verify skeleton → one fix attempt if needed
 * 5. Implement phase — per-module LLM calls replace stubs with real code
 * 6. After each module → tsc verify → fix loop
 * 7. Final npm run build
 * 8. Build artifact analysis (zero LLM cost)
 * 9. HTTP smoke test (zero LLM cost, only for web projects)
 * 10. Generate manifest + README
 */
export class CoderAgent extends BaseAgent {
  private interactionHandler?: InteractionHandler;

  constructor(
    stage: StageName,
    provider: LLMProvider,
    logger: Logger,
    interactionHandler?: InteractionHandler,
  ) {
    super(stage, provider, logger);
    this.interactionHandler = interactionHandler;
  }

  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['code/'],
      manifest: 'code.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const autonomy = context.task.autonomy;
    const totalBudget = autonomy?.max_budget_usd ?? 5;

    // Check for test failure feedback (Tester → Coder fix loop)
    const testFailures = context.inputArtifacts.get('test_failures');

    // Step 1: Get or create code plan
    let plan: CodePlan;
    if (artifactExists('code-plan.json')) {
      plan = CodePlanSchema.parse(JSON.parse(readArtifact('code-plan.json')));
      this.logger.agent(this.stage, 'info', 'planner:reuse', {
        modules: plan.modules.length,
      });
    } else {
      plan = await this.runPlanner(context);
    }

    // Step 2: Skeleton phase
    if (this.isSkeletonComplete(plan)) {
      this.logger.agent(this.stage, 'info', 'skeleton:reuse', {
        message: 'All skeleton files exist on disk — skipping skeleton phase',
      });
      eventBus.emit('agent:progress', this.stage, 'skeleton: reusing existing files (retry scenario)');
    } else {
      await this.runSkeleton(context, plan);
    }

    // Step 3: npm install
    eventBus.emit('agent:progress', this.stage, `running: ${plan.commands.setupCommand}`);
    this.runSetupCommand(plan);

    // Step 4: Verify skeleton with tsc
    eventBus.emit('agent:progress', this.stage, `verifying skeleton: ${plan.commands.verifyCommand}`);
    const skeletonVerify = this.runVerifyCommand(plan);
    if (skeletonVerify.success) {
      eventBus.emit('agent:progress', this.stage, 'skeleton: tsc passed');
    } else {
      eventBus.emit('agent:progress', this.stage, 'skeleton: tsc failed — attempting fix...');
      this.logger.agent(this.stage, 'warn', 'skeleton:verify-failed', {
        errors: skeletonVerify.errors.slice(0, 1000),
      });
      // One fix attempt for skeleton errors
      await this.runSkeletonFix(context, plan, skeletonVerify.errors, totalBudget * 0.15);
    }

    // Step 5: Implement phase — per-module
    const modulesToImplement = this.getModulesToImplement(plan, testFailures);

    if (modulesToImplement.length === 0) {
      this.logger.agent(this.stage, 'info', 'implement:all-modules-complete', {
        totalModules: plan.modules.length,
      });
    } else {
      const builderBudget = totalBudget - PLANNER_BUDGET_USD - SKELETON_BUDGET_USD;
      const perModuleBudget = modulesToImplement.length > 0
        ? builderBudget / modulesToImplement.length
        : builderBudget;

      // Build scaffold first if in the implement list
      const scaffoldModule = modulesToImplement.find(m => m.priority === 0);
      if (scaffoldModule) {
        eventBus.emit('agent:progress', this.stage, `[scaffold] implementing ${scaffoldModule.files.length} files...`);
        await this.implementModule(context, plan, scaffoldModule, perModuleBudget);
        eventBus.emit('agent:progress', this.stage, `[scaffold] running: ${plan.commands.setupCommand}`);
        this.runSetupCommand(plan);
      }

      // Implement remaining modules by priority
      const nonScaffold = modulesToImplement
        .filter(m => m.priority !== 0)
        .sort((a, b) => a.priority - b.priority);

      for (let mi = 0; mi < nonScaffold.length; mi++) {
        const mod = nonScaffold[mi];
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] implementing "${mod.name}" — ${mod.files.length} files`);
        await this.implementModule(context, plan, mod, perModuleBudget);

        // Verify after each module
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verifying: ${plan.commands.verifyCommand}`);
        const verifyResult = this.runVerifyCommand(plan);
        if (verifyResult.success) {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verify passed`);
        } else {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verify failed — attempting fix...`);
          let fixed = false;
          let lastErrors = verifyResult.errors;
          for (let retry = 1; ; retry++) {
            if (retry > AUTO_FIX_RETRIES) {
              const shouldContinue = await this.askUserToRetry(mod.name, retry - 1, lastErrors);
              if (!shouldContinue) {
                eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] user chose to skip — continuing`);
                break;
              }
            }

            eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] fix attempt ${retry}...`);
            this.logger.agent(this.stage, 'warn', 'implement:verify-failed', {
              module: mod.name,
              retry,
              errors: lastErrors.slice(0, 500),
            });

            logRetry({
              timestamp: new Date().toISOString(),
              runId: context.task.runId,
              stage: this.stage,
              source: 'coder-module-fix',
              attempt: retry,
              errorCategory: classifyError(lastErrors),
              errorMessage: lastErrors,
              resolved: false,
              module: mod.name,
            });

            await this.implementModuleWithErrors(
              context, plan, mod, perModuleBudget, lastErrors, retry
            );

            const retryResult = this.runVerifyCommand(plan);
            if (retryResult.success) {
              eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] fix succeeded (attempt ${retry})`);
              fixed = true;
              break;
            }
            lastErrors = retryResult.errors;
          }

          if (!fixed) {
            this.logger.agent(this.stage, 'warn', 'implement:verify-gave-up', {
              module: mod.name,
            });
          }
        }
      }
    }

    // Step 6: Final build check
    eventBus.emit('agent:progress', this.stage, `running final build: ${plan.commands.buildCommand}`);
    const buildResult = this.runBuildCommand(plan);
    if (buildResult.success) {
      eventBus.emit('agent:progress', this.stage, 'build passed');
    } else {
      eventBus.emit('agent:progress', this.stage, 'build failed — attempting fix...');
      this.logger.agent(this.stage, 'warn', 'build:failed', {
        errors: buildResult.errors.slice(0, 1000),
      });
      await this.runBuildFix(context, plan, buildResult.errors, totalBudget * 0.2);
    }

    // Step 7: Run acceptance tests (if available)
    await this.runAcceptanceTests(context, plan, totalBudget * 0.2);

    // Step 8: Build artifact analysis (zero LLM cost)
    this.analyzeBuildArtifacts(plan);

    // Step 9: HTTP smoke test (zero LLM cost)
    await this.runSmokeTest(plan);

    // Step 10: Generate manifest + README
    this.generateManifest(plan);
    this.generateReadme(plan);
  }

  // ─── Acceptance Tests ────────────────────────────────────────

  /**
   * Run acceptance tests written by QALead (if they exist).
   * On failure: attempt fix cycles with escalating strategies.
   */
  private async runAcceptanceTests(
    context: AgentContext,
    plan: CodePlan,
    fixBudgetUsd: number,
  ): Promise<void> {
    const codeDir = `${getArtifactsDir()}/code`;
    const testsDir = `${getArtifactsDir()}/tests/acceptance`;

    // Check if acceptance tests exist
    if (!fs.existsSync(testsDir)) {
      this.logger.agent(this.stage, 'info', 'acceptance:skipped', {
        reason: 'no tests/acceptance/ directory',
      });
      return;
    }

    // Install test dependencies if test plan exists
    try {
      const testPlanManifest = readArtifact('test-plan.manifest.json');
      const manifest = JSON.parse(testPlanManifest);
      if (manifest.commands?.setupCommand) {
        eventBus.emit('agent:progress', this.stage, `acceptance: installing test deps`);
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

      eventBus.emit('coder:fix-round', round, result.total, result.passed,
        round === 1 ? 'initial run' : `fix attempt ${round - 1}`);

      if (result.passed === result.total) {
        eventBus.emit('agent:progress', this.stage, `acceptance: all ${result.total} tests passed`);
        this.logger.agent(this.stage, 'info', 'acceptance:passed', {
          total: result.total,
          passed: result.passed,
          rounds: round,
        });
        return;
      }

      if (round >= MAX_ACCEPTANCE_FIX_ROUNDS) {
        eventBus.emit('agent:progress', this.stage, `acceptance: ${result.passed}/${result.total} passed after ${round} rounds`);
        this.logger.agent(this.stage, 'warn', 'acceptance:partial', {
          total: result.total,
          passed: result.passed,
          failed: result.failed,
          rounds: round,
        });
        return;
      }

      // Fix: send failures to builder for targeted fix
      eventBus.emit('agent:progress', this.stage, `acceptance: ${result.failed} failed — fix round ${round}...`);

      logRetry({
        timestamp: new Date().toISOString(),
        runId: context.task.runId,
        stage: this.stage,
        source: 'coder-acceptance-fix',
        attempt: round,
        errorCategory: 'test-failure',
        errorMessage: result.errors,
        resolved: false,
      });

      await this.fixAcceptanceFailures(context, plan, result.errors, perRoundBudget);
    }
  }

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

  private async fixAcceptanceFailures(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;

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

    await this.provider.call(prompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });
  }

  // ─── Planner ─────────────────────────────────────────────────

  private async runPlanner(context: AgentContext): Promise<CodePlan> {
    const plannerPrompt = fs.readFileSync(PLANNER_PROMPT_PATH, 'utf-8');

    const parts: string[] = ['## Task\nAnalyze the technical specification and produce a code-plan.json.\n'];
    const techSpec = context.inputArtifacts.get('tech-spec.md');
    if (techSpec) parts.push(`## tech-spec.md\n${techSpec}\n`);
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec) parts.push(`## api-spec.yaml\n${apiSpec}\n`);

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'planner:start', {
      promptLength: userPrompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: plannerPrompt,
      maxBudgetUsd: PLANNER_BUDGET_USD,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);

    const planJson = this.extractArtifact(response.content, 'code-plan.json');
    if (!planJson) {
      throw new Error('Planner did not produce a code-plan.json ARTIFACT block');
    }

    const plan = CodePlanSchema.parse(JSON.parse(planJson));
    this.writeOutput('code-plan.json', JSON.stringify(plan, null, 2));

    this.logger.agent(this.stage, 'info', 'planner:complete', {
      modules: plan.modules.length,
      totalFiles: plan.modules.reduce((sum, m) => sum + m.files.length, 0),
    });

    return plan;
  }

  // ─── Skeleton ───────────────────────────────────────────────

  private async runSkeleton(context: AgentContext, plan: CodePlan): Promise<void> {
    const skeletonPrompt = fs.readFileSync(SKELETON_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;

    // Build the complete file list across all modules
    const allFiles = plan.modules.flatMap(m => m.files);

    const parts: string[] = [];
    parts.push('## Task');
    parts.push('Create the complete project skeleton — all files with real imports, exports, and routes but stub implementations.');
    parts.push('');
    parts.push(`## Output Directory\n${codeDir}`);
    parts.push('');
    parts.push(`## Verify Command\n\`${plan.commands.verifyCommand}\``);
    parts.push('');
    parts.push('## code-plan.json');
    parts.push('```json');
    parts.push(JSON.stringify(plan, null, 2));
    parts.push('```');
    parts.push('');
    parts.push(`## All Files to Create (${allFiles.length} total)`);
    for (const f of allFiles) {
      parts.push(`- ${codeDir}/${f}`);
    }
    parts.push('');

    // Add tech-spec and api-spec for context
    const techSpec = context.inputArtifacts.get('tech-spec.md');
    if (techSpec) parts.push(`## tech-spec.md\n${techSpec}\n`);
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec) parts.push(`## api-spec.yaml\n${apiSpec}\n`);

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'skeleton:start', {
      promptLength: userPrompt.length,
      totalFiles: allFiles.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);
    eventBus.emit('agent:progress', this.stage, `skeleton: writing ${allFiles.length} files...`);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: skeletonPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: SKELETON_BUDGET_USD,
      timeoutMs: SKELETON_TIMEOUT_MS,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);
    this.logger.agent(this.stage, 'info', 'skeleton:complete', {
      totalFiles: allFiles.length,
    });
  }

  /**
   * Check if all skeleton files already exist on disk (retry/resume scenario).
   */
  private isSkeletonComplete(plan: CodePlan): boolean {
    const codeDir = `${getArtifactsDir()}/code`;
    return plan.modules.every(mod =>
      mod.files.every(f => fs.existsSync(`${codeDir}/${f}`))
    );
  }

  /**
   * Fix skeleton compilation errors — single attempt.
   */
  private async runSkeletonFix(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const skeletonPrompt = fs.readFileSync(SKELETON_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;
    const errorFiles = this.extractErrorFiles(errors, codeDir);

    const parts: string[] = [];
    parts.push('## Fix Skeleton Compilation Errors');
    parts.push(`Working directory: ${codeDir}`);
    parts.push('');
    parts.push('## Errors');
    parts.push('```');
    parts.push(errors.slice(0, 3000));
    parts.push('```');
    parts.push('');

    if (errorFiles.length > 0) {
      parts.push('## Files with errors (read these first, then fix)');
      for (const f of errorFiles.slice(0, 15)) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('1. Read each file that has errors');
    parts.push('2. Fix the compilation errors — keep all existing imports and exports intact');
    parts.push('3. Write only the files that need fixing');

    const fixPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'skeleton:fix-start', {
      errorFiles: errorFiles.length,
    });

    await this.provider.call(fixPrompt, {
      systemPrompt: skeletonPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: BUILD_FIX_TIMEOUT_MS,
    });

    this.logger.agent(this.stage, 'info', 'skeleton:fix-complete', {});
  }

  // ─── Implement (per-module) ─────────────────────────────────

  private async implementModule(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const userPrompt = this.buildImplementPrompt(context, plan, mod);

    this.logger.agent(this.stage, 'info', 'implement:module-start', {
      module: mod.name,
      files: mod.files.length,
      priority: mod.priority,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);

    this.logger.agent(this.stage, 'info', 'implement:module-complete', {
      module: mod.name,
    });
  }

  private async implementModuleWithErrors(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    budgetUsd: number,
    errors: string,
    retryNumber: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;
    const errorFiles = this.extractErrorFiles(errors, codeDir);

    const parts: string[] = [];
    parts.push(`## Fix Compilation Errors (attempt ${retryNumber})`);
    parts.push(`Module: ${mod.name}`);
    parts.push(`Working directory: ${codeDir}`);
    parts.push('');
    parts.push('## Errors');
    parts.push('```');
    parts.push(errors.slice(0, 3000));
    parts.push('```');
    parts.push('');

    if (errorFiles.length > 0) {
      parts.push('## Files with errors (read these first, then fix)');
      for (const f of errorFiles.slice(0, 10)) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('1. Use the Read tool to read each file that has errors');
    parts.push('2. Understand the root cause of each error');
    parts.push('3. Use the Write tool to fix ONLY the files that have errors');
    parts.push('4. Do not rewrite files that compile correctly');
    parts.push('5. Preserve all import paths and export signatures from the skeleton');

    const errorPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'implement:fix-start', {
      module: mod.name,
      retry: retryNumber,
      errorFiles: errorFiles.length,
    });
    eventBus.emit('agent:thinking', this.stage, errorPrompt.length);

    const response = await this.provider.call(errorPrompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);

    this.logger.agent(this.stage, 'info', 'implement:fix-complete', {
      module: mod.name,
      retry: retryNumber,
    });
  }

  private buildImplementPrompt(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
  ): string {
    const codeDir = `${getArtifactsDir()}/code`;
    const parts: string[] = [];

    parts.push(`## Module: ${mod.name}`);
    parts.push(`Description: ${mod.description}`);
    parts.push(`Working directory: ${codeDir}`);
    parts.push('');

    // List files to implement — these already exist as skeletons
    parts.push('## Files to Implement (skeleton stubs → real code)');
    parts.push('These files already exist from the skeleton phase. Read each one first, then replace stub implementations with real code.');
    for (const f of mod.files) {
      parts.push(`- ${codeDir}/${f}`);
    }
    parts.push('');

    // Tech stack context
    parts.push('## Tech Stack');
    parts.push(`Language: ${plan.tech_stack.language}`);
    parts.push(`Framework: ${plan.tech_stack.framework}`);
    parts.push(`Build tool: ${plan.tech_stack.build_tool}`);
    parts.push('');

    // All project files for import reference
    const builtFiles = this.listBuiltFiles(codeDir);
    if (builtFiles.length > 0) {
      parts.push('## All Project Files (for import reference)');
      for (const f of builtFiles) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    // Trimmed API spec (only features this module covers)
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec && mod.covers_features.length > 0) {
      parts.push(`## API Spec (relevant sections)\n${apiSpec}\n`);
    }

    // Tech spec excerpt for task details
    const techSpec = context.inputArtifacts.get('tech-spec.md');
    if (techSpec && mod.covers_tasks.length > 0) {
      parts.push(`## Relevant Tasks: ${mod.covers_tasks.join(', ')}`);
      parts.push('Refer to the tech-spec for full task details.\n');
    }

    return parts.join('\n');
  }

  /**
   * Determine which modules need implementation.
   * On test-failure retarget: only rebuild modules with failing tests.
   * Otherwise: all modules (skeleton wrote stubs, implement replaces them).
   * If all files have substantial content (retry scenario), skip.
   */
  private getModulesToImplement(
    plan: CodePlan,
    testFailures?: string,
  ): CodePlanModule[] {
    if (testFailures) {
      // Targeted rebuild: only modules with failing tests
      try {
        const report = JSON.parse(testFailures);
        const failedModules = new Set<string>();
        for (const failure of report.failures ?? []) {
          if (failure.module) failedModules.add(failure.module);
        }
        if (failedModules.size > 0) {
          this.logger.agent(this.stage, 'info', 'implement:targeted-rebuild', {
            failedModules: Array.from(failedModules),
          });
          return plan.modules.filter(m => failedModules.has(m.name));
        }
      } catch {
        // If test_failures isn't valid JSON, fall through to full implementation
      }
    }

    // All modules need implementation (skeleton wrote stubs)
    return plan.modules;
  }

  // ─── User Confirmation ──────────────────────────────────────

  private async askUserToRetry(moduleName: string, attempts: number, errors: string): Promise<boolean> {
    if (!this.interactionHandler) {
      return false;
    }

    const errorPreview = errors.slice(0, 500);
    const answer = await this.interactionHandler.onClarification(
      this.stage,
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

  // ─── Build Fix (final build failure) ────────────────────────

  private async runBuildFix(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;
    const builtFiles = this.listBuiltFiles(codeDir);

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

    this.logger.agent(this.stage, 'info', 'build:fix-start', {});

    await this.provider.call(prompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: BUILD_FIX_TIMEOUT_MS,
    });

    this.logger.agent(this.stage, 'info', 'build:fix-complete', {});
  }

  // ─── Build Artifact Analysis ────────────────────────────────

  /**
   * Analyze build output for quality signals (zero LLM cost).
   * Checks: dist/ exists, bundle size, placeholder keywords, HTML references.
   */
  private analyzeBuildArtifacts(plan: CodePlan): void {
    const codeDir = `${getArtifactsDir()}/code`;
    const distDir = `${codeDir}/dist`;
    const warnings: string[] = [];

    // Check 1: dist/ exists and is non-empty
    if (!fs.existsSync(distDir)) {
      warnings.push('dist/ directory does not exist after build');
      this.logAnalysisResult(warnings);
      return;
    }

    const distFiles = this.listBuiltFiles(distDir);
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
      this.logger.agent(this.stage, 'info', 'analysis:passed', {
        message: 'Build artifact analysis passed — no warnings',
      });
      eventBus.emit('agent:progress', this.stage, 'build analysis: passed');
    } else {
      this.logger.agent(this.stage, 'warn', 'analysis:warnings', { warnings });
      eventBus.emit('agent:progress', this.stage, `build analysis: ${warnings.length} warning(s) — ${warnings[0]}`);
    }
  }

  // ─── HTTP Smoke Test ────────────────────────────────────────

  /**
   * Run HTTP smoke test for web projects.
   * Starts the preview server, fetches the page, checks for non-empty content.
   */
  async runSmokeTest(plan: CodePlan): Promise<void> {
    if (!plan.smokeTest || plan.smokeTest.type !== 'web') {
      this.logger.agent(this.stage, 'info', 'smoke:skipped', {
        reason: plan.smokeTest ? `type is ${plan.smokeTest.type}` : 'no smokeTest config',
      });
      return;
    }

    const { startCommand, port, readyPattern } = plan.smokeTest;
    if (!port) {
      this.logger.agent(this.stage, 'info', 'smoke:skipped', { reason: 'no port configured' });
      return;
    }

    const codeDir = `${getArtifactsDir()}/code`;
    eventBus.emit('agent:progress', this.stage, `smoke test: starting ${startCommand}...`);

    let proc: ChildProcess | undefined;
    try {
      // Start the preview server
      const [cmd, ...cmdArgs] = startCommand.split(' ');
      proc = spawn(cmd, cmdArgs, {
        cwd: codeDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      // Wait for port to be ready
      const ready = await this.waitForPort(port, SMOKE_TEST_TIMEOUT_MS, readyPattern, proc);
      if (!ready) {
        this.logger.agent(this.stage, 'warn', 'smoke:timeout', {
          message: `Server did not start within ${SMOKE_TEST_TIMEOUT_MS}ms`,
        });
        eventBus.emit('agent:progress', this.stage, 'smoke test: server timeout');
        return;
      }

      // Fetch the page
      const response = await fetch(`http://localhost:${port}`);
      const html = await response.text();

      const issues: string[] = [];

      // Check HTML length
      if (html.length < MIN_HTML_LENGTH) {
        issues.push(`HTML too short (${html.length} chars < ${MIN_HTML_LENGTH})`);
      }

      // Check for placeholder keywords
      for (const keyword of PLACEHOLDER_KEYWORDS) {
        if (html.includes(keyword)) {
          issues.push(`Placeholder keyword "${keyword}" in response`);
        }
      }

      if (issues.length === 0) {
        this.logger.agent(this.stage, 'info', 'smoke:passed', {
          htmlLength: html.length,
        });
        eventBus.emit('agent:progress', this.stage, `smoke test: passed (${html.length} chars)`);
      } else {
        this.logger.agent(this.stage, 'warn', 'smoke:issues', { issues });
        eventBus.emit('agent:progress', this.stage, `smoke test: ${issues.length} issue(s) — ${issues[0]}`);
      }
    } catch (err) {
      this.logger.agent(this.stage, 'warn', 'smoke:error', {
        error: err instanceof Error ? err.message : String(err),
      });
      eventBus.emit('agent:progress', this.stage, 'smoke test: error — ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      // Kill the server process group
      if (proc?.pid) {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch { /* already dead */ }
      }
    }
  }

  /**
   * Wait for a TCP port to become available.
   * Optionally also checks stdout for a readyPattern.
   */
  private waitForPort(
    port: number,
    timeoutMs: number,
    readyPattern?: string,
    proc?: ChildProcess,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const startTime = Date.now();
      let resolved = false;

      const done = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearInterval(timer);
          resolve(result);
        }
      };

      // Watch stdout for readyPattern
      if (readyPattern && proc?.stdout) {
        const regex = new RegExp(readyPattern);
        proc.stdout.on('data', (data: Buffer) => {
          if (regex.test(data.toString())) {
            done(true);
          }
        });
      }

      // Also handle process exit
      if (proc) {
        proc.on('exit', () => done(false));
      }

      // TCP poll
      const timer = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          done(false);
          return;
        }

        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.once('connect', () => {
          socket.destroy();
          done(true);
        });
        socket.once('error', () => socket.destroy());
        socket.once('timeout', () => socket.destroy());
        socket.connect(port, '127.0.0.1');
      }, 500);
    });
  }

  // ─── Programmatic Commands ──────────────────────────────────

  private runSetupCommand(plan: CodePlan): void {
    const codeDir = `${getArtifactsDir()}/code`;
    try {
      this.logger.agent(this.stage, 'info', 'cmd:setup', { command: plan.commands.setupCommand });
      execSync(plan.commands.setupCommand, {
        cwd: codeDir,
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch (err) {
      this.logger.agent(this.stage, 'warn', 'cmd:setup-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private runVerifyCommand(plan: CodePlan): { success: boolean; errors: string } {
    const codeDir = `${getArtifactsDir()}/code`;
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

  private runBuildCommand(plan: CodePlan): { success: boolean; errors: string } {
    const codeDir = `${getArtifactsDir()}/code`;
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

  // ─── Error Extraction ─────────────────────────────────────

  /**
   * Extract file paths from compilation error output.
   */
  private extractErrorFiles(errors: string, codeDir: string): string[] {
    const files = new Set<string>();
    const tsPattern = /^([^\s(]+\.tsx?)\(\d+,\d+\)/gm;
    const bundlerPattern = /(?:ERROR|error)\s+(?:in\s+)?\.?\/?([^\s:]+\.(?:ts|tsx|js|jsx))/gm;

    let match;
    while ((match = tsPattern.exec(errors)) !== null) {
      files.add(`${codeDir}/${match[1]}`);
    }
    while ((match = bundlerPattern.exec(errors)) !== null) {
      files.add(`${codeDir}/${match[1]}`);
    }

    return [...files];
  }

  // ─── File Helpers ─────────────────────────────────────────

  private listBuiltFiles(codeDir: string): string[] {
    const files: string[] = [];
    try {
      this.walkDir(codeDir, codeDir, files);
    } catch {
      // Directory may not exist yet
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

  // ─── Artifact Extraction ────────────────────────────────────

  private extractArtifact(content: string, name: string): string | null {
    const startTag = `<!-- ARTIFACT:${name} -->`;
    const endTag = `<!-- END:${name} -->`;
    const startIdx = content.indexOf(startTag);
    const endIdx = content.indexOf(endTag);
    if (startIdx === -1 || endIdx === -1) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? jsonMatch[0] : null;
    }
    return content.slice(startIdx + startTag.length, endIdx).trim();
  }

  // ─── Manifest Generation ───────────────────────────────────

  private generateManifest(plan: CodePlan): void {
    const codeDir = `${getArtifactsDir()}/code`;
    const allFiles = this.listBuiltFiles(codeDir);

    const fileEntries = allFiles.map(filePath => {
      const mod = plan.modules.find(m => m.files.some(f => filePath.endsWith(f) || f.endsWith(filePath)));
      return {
        path: `code/${filePath}`,
        module: mod?.name ?? 'unknown',
        description: '',
      };
    });

    const manifest = {
      files: fileEntries,
      modules: plan.modules.map(m => m.name),
      covers_tasks: [...new Set(plan.modules.flatMap(m => m.covers_tasks))],
      covers_features: [...new Set(plan.modules.flatMap(m => m.covers_features))],
    };

    this.writeOutputManifest('code.manifest.json', manifest);

    this.logger.agent(this.stage, 'info', 'manifest:generated', {
      files: fileEntries.length,
      modules: manifest.modules.length,
    });
  }

  // ─── README Generation ────────────────────────────────────

  private generateReadme(plan: CodePlan): void {
    const codeDir = `${getArtifactsDir()}/code`;
    const lines: string[] = [];

    lines.push(`# ${plan.project_name}`);
    lines.push('');

    try {
      const briefRaw = readArtifact('intent-brief.json');
      const brief = JSON.parse(briefRaw);
      if (brief.problem) lines.push(brief.problem);
      lines.push('');
      if (brief.target_users) lines.push(`**Target Users:** ${brief.target_users}`);
      if (brief.core_scenarios?.length > 0) {
        lines.push('');
        lines.push('**Core Scenarios:**');
        for (const s of brief.core_scenarios) {
          lines.push(`- ${s}`);
        }
      }
      lines.push('');
    } catch {
      lines.push(`A ${plan.tech_stack.framework} project.`);
      lines.push('');
    }

    try {
      const prdRaw = readArtifact('prd.manifest.json');
      const prd = JSON.parse(prdRaw);
      if (prd.features?.length > 0) {
        lines.push('## Features');
        lines.push('');
        for (const f of prd.features) {
          lines.push(`- **${f.id}**: ${f.name}`);
        }
        lines.push('');
      }
    } catch {
      // No PRD manifest — skip
    }

    lines.push('## Tech Stack');
    lines.push('');
    lines.push(`| Layer | Technology |`);
    lines.push(`|---|---|`);
    lines.push(`| Language | ${plan.tech_stack.language} |`);
    lines.push(`| Framework | ${plan.tech_stack.framework} |`);
    lines.push(`| Build Tool | ${plan.tech_stack.build_tool} |`);
    lines.push('');

    lines.push('## Quick Start');
    lines.push('');
    lines.push('```bash');
    lines.push(plan.commands.setupCommand);
    lines.push(plan.commands.buildCommand);
    lines.push('```');
    lines.push('');

    const nonScaffoldModules = plan.modules.filter(m => m.priority > 0);
    if (nonScaffoldModules.length > 1) {
      lines.push('## Architecture');
      lines.push('');
      lines.push('```mermaid');
      lines.push('graph TD');

      for (const mod of nonScaffoldModules) {
        const label = `${mod.name}["${mod.name}<br/><small>${this.escapeForMermaid(mod.description)}</small>"]`;
        lines.push(`  ${label}`);
      }

      for (const mod of nonScaffoldModules) {
        for (const dep of mod.dependencies) {
          if (dep === 'scaffold') continue;
          lines.push(`  ${dep} --> ${mod.name}`);
        }
      }

      lines.push('```');
      lines.push('');
    }

    lines.push('## Modules');
    lines.push('');
    lines.push('| Module | Description | Files | Features |');
    lines.push('|---|---|---|---|');
    for (const mod of plan.modules) {
      const features = mod.covers_features.join(', ') || '—';
      lines.push(`| ${mod.name} | ${mod.description} | ${mod.files.length} | ${features} |`);
    }
    lines.push('');

    lines.push('## Project Structure');
    lines.push('');
    lines.push('```');
    const tree = this.buildDirectoryTree(codeDir, 3);
    lines.push(tree);
    lines.push('```');
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('_Generated by [Mosaicat](https://github.com/ZB-ur/mosaicat) pipeline_');

    const readmeContent = lines.join('\n');
    fs.writeFileSync(`${codeDir}/README.md`, readmeContent, 'utf-8');
    this.writeOutput('code/README.md', readmeContent);

    this.logger.agent(this.stage, 'info', 'readme:generated', {
      size: readmeContent.length,
    });
  }

  private escapeForMermaid(text: string): string {
    return text
      .replace(/"/g, "'")
      .replace(/[<>]/g, '')
      .slice(0, 60);
  }

  private buildDirectoryTree(dir: string, maxDepth: number): string {
    const skipDirs = new Set(['node_modules', 'dist', 'build', '.turbo', '.cache', '.git']);
    const lines: string[] = [];
    const baseName = dir.split('/').pop() ?? dir;
    lines.push(`${baseName}/`);

    const walk = (currentDir: string, prefix: string, depth: number) => {
      if (depth >= maxDepth) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      const dirs = entries.filter(e => e.isDirectory() && !skipDirs.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      const all = [...dirs, ...files];

      for (let i = 0; i < all.length; i++) {
        const entry = all[i];
        const isLast = i === all.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        if (entry.isDirectory()) {
          lines.push(`${prefix}${connector}${entry.name}/`);
          walk(`${currentDir}/${entry.name}`, `${prefix}${childPrefix}`, depth + 1);
        } else {
          lines.push(`${prefix}${connector}${entry.name}`);
        }
      }
    };

    walk(dir, '', 0);
    return lines.join('\n');
  }
}
