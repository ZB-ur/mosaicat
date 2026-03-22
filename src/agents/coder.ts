import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext, StageName } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { InteractionHandler } from '../core/interaction-handler.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { readArtifact, artifactExists, getArtifactsDir } from '../core/artifact.js';
import { CodePlanSchema, type CodePlan, type CodePlanModule } from './code-plan-schema.js';

const PLANNER_PROMPT_PATH = '.claude/agents/mosaic/code-planner.md';
const BUILDER_PROMPT_PATH = '.claude/agents/mosaic/code-builder.md';

/** Per-module build timeout: 5 minutes */
const MODULE_TIMEOUT_MS = 300_000;
/** Build fix timeout: 10 minutes (needs time to diagnose + fix across files) */
const BUILD_FIX_TIMEOUT_MS = 600_000;
/** Planner budget */
const PLANNER_BUDGET_USD = 0.50;
/** Number of automatic fix retries before asking user confirmation */
const AUTO_FIX_RETRIES = 3;

/**
 * High-autonomy Coder Agent with planner/builder split.
 *
 * Flow:
 * 1. Check disk for existing code-plan.json (retry reuse)
 * 2. If not found → run Planner (no tool use, ARTIFACT block output)
 * 3. Load existing modules from disk (resume support)
 * 4. Build scaffold module first → run setupCommand
 * 5. Build remaining modules sequentially by priority
 * 6. After each module → run verifyCommand (programmatic)
 * 7. If verify fails → inject errors and retry module (max 2 times)
 * 8. Final buildCommand check
 * 9. Generate code.manifest.json programmatically
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

    // Step 2: Determine which modules need building
    const builtModules = this.loadExistingModules(plan);
    const modulesToBuild = this.getModulesToBuild(plan, builtModules, testFailures);

    if (modulesToBuild.length === 0) {
      this.logger.agent(this.stage, 'info', 'builder:all-modules-complete', {
        totalModules: plan.modules.length,
      });
    } else {
      // Budget allocation: remaining budget / number of modules to build
      const builderBudget = totalBudget - PLANNER_BUDGET_USD;
      const perModuleBudget = modulesToBuild.length > 0
        ? builderBudget / modulesToBuild.length
        : builderBudget;

      // Step 3: Build scaffold first if needed
      const scaffoldModule = modulesToBuild.find(m => m.priority === 0);
      if (scaffoldModule) {
        eventBus.emit('agent:progress', this.stage, `[scaffold] building ${scaffoldModule.files.length} files...`);
        await this.buildModule(context, plan, scaffoldModule, builtModules, perModuleBudget);
        builtModules.add(scaffoldModule.name);
        eventBus.emit('agent:progress', this.stage, `[scaffold] running: ${plan.commands.setupCommand}`);
        this.runSetupCommand(plan);
      }

      // Step 4: Build remaining modules by priority
      const nonScaffold = modulesToBuild
        .filter(m => m.priority !== 0)
        .sort((a, b) => a.priority - b.priority);

      for (let mi = 0; mi < nonScaffold.length; mi++) {
        const mod = nonScaffold[mi];
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] module "${mod.name}" — ${mod.files.length} files`);
        await this.buildModule(context, plan, mod, builtModules, perModuleBudget);
        builtModules.add(mod.name);

        // Verify after each module
        eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] verifying: ${plan.commands.verifyCommand}`);
        const verifyResult = this.runVerifyCommand(plan);
        if (verifyResult.success) {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] ✓ verify passed`);
        } else {
          eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] ✗ verify failed — attempting fix...`);
          // Try to fix compilation errors — no hard limit, ask user after AUTO_FIX_RETRIES
          let fixed = false;
          let lastErrors = verifyResult.errors;
          for (let retry = 1; ; retry++) {
            // After AUTO_FIX_RETRIES automatic attempts, ask user
            if (retry > AUTO_FIX_RETRIES) {
              const shouldContinue = await this.askUserToRetry(mod.name, retry - 1, lastErrors);
              if (!shouldContinue) {
                eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] ⚠ user chose to skip — continuing`);
                break;
              }
            }

            eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] fix attempt ${retry}...`);
            this.logger.agent(this.stage, 'warn', 'builder:verify-failed', {
              module: mod.name,
              retry,
              errors: lastErrors.slice(0, 500),
            });

            await this.buildModuleWithErrors(
              context, plan, mod, builtModules, perModuleBudget, lastErrors, retry
            );

            const retryResult = this.runVerifyCommand(plan);
            if (retryResult.success) {
              eventBus.emit('agent:progress', this.stage, `[${mi + 1}/${nonScaffold.length}] ✓ fix succeeded (attempt ${retry})`);
              fixed = true;
              break;
            }
            lastErrors = retryResult.errors;
          }

          if (!fixed) {
            this.logger.agent(this.stage, 'warn', 'builder:verify-gave-up', {
              module: mod.name,
            });
          }
        }
      }
    }

    // Step 5: Final build check
    eventBus.emit('agent:progress', this.stage, `running final build: ${plan.commands.buildCommand}`);
    const buildResult = this.runBuildCommand(plan);
    if (buildResult.success) {
      eventBus.emit('agent:progress', this.stage, '✓ build passed');
    } else {
      eventBus.emit('agent:progress', this.stage, '✗ build failed — attempting fix...');
      this.logger.agent(this.stage, 'warn', 'builder:build-failed', {
        errors: buildResult.errors.slice(0, 1000),
      });
      // One fix attempt for build errors
      await this.runBuildFix(context, plan, builtModules, buildResult.errors, totalBudget * 0.2);
    }

    // Step 6: Generate manifest programmatically
    this.generateManifest(plan);

    // Step 7: Generate README.md (pure programmatic, no LLM)
    this.generateReadme(plan);
  }

  // ─── Planner ─────────────────────────────────────────────────

  private async runPlanner(context: AgentContext): Promise<CodePlan> {
    const plannerPrompt = fs.readFileSync(PLANNER_PROMPT_PATH, 'utf-8');

    // Build user prompt with input artifacts
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

    // Extract code-plan.json from ARTIFACT block
    const planJson = this.extractArtifact(response.content, 'code-plan.json');
    if (!planJson) {
      throw new Error('Planner did not produce a code-plan.json ARTIFACT block');
    }

    const plan = CodePlanSchema.parse(JSON.parse(planJson));

    // Write plan to disk for reuse
    this.writeOutput('code-plan.json', JSON.stringify(plan, null, 2));

    this.logger.agent(this.stage, 'info', 'planner:complete', {
      modules: plan.modules.length,
      totalFiles: plan.modules.reduce((sum, m) => sum + m.files.length, 0),
    });

    return plan;
  }

  // ─── Builder ─────────────────────────────────────────────────

  private async buildModule(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    builtModules: Set<string>,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const userPrompt = this.buildModulePrompt(context, plan, mod, builtModules);

    this.logger.agent(this.stage, 'info', 'builder:module-start', {
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

    this.logger.agent(this.stage, 'info', 'builder:module-complete', {
      module: mod.name,
    });
  }

  private async buildModuleWithErrors(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    builtModules: Set<string>,
    budgetUsd: number,
    errors: string,
    retryNumber: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;

    // Extract file paths from error messages for targeted fix
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

    // Guide the LLM to read files first
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

    const errorPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'builder:fix-start', {
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

    this.logger.agent(this.stage, 'info', 'builder:fix-complete', {
      module: mod.name,
      retry: retryNumber,
    });
  }

  /**
   * Extract file paths from compilation error output.
   * Handles common patterns: "src/foo.ts(10,5): error TS..." or "ERROR in ./src/foo.ts"
   */
  private extractErrorFiles(errors: string, codeDir: string): string[] {
    const files = new Set<string>();
    // TypeScript pattern: src/foo.ts(line,col): error
    const tsPattern = /^([^\s(]+\.tsx?)\(\d+,\d+\)/gm;
    // Webpack/Vite pattern: ERROR in ./src/foo.ts
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

  private buildModulePrompt(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    builtModules: Set<string>,
  ): string {
    const codeDir = `${getArtifactsDir()}/code`;
    const parts: string[] = [];

    parts.push(`## Module: ${mod.name}`);
    parts.push(`Description: ${mod.description}`);
    parts.push(`Files to write: ${mod.files.join(', ')}`);
    parts.push(`Dependencies: ${mod.dependencies.join(', ') || 'none'}`);
    parts.push(`Write all files under: ${codeDir}/`);
    parts.push('');

    // Warn about files that already exist (from previous modules)
    const existingFiles = mod.files.filter(f => {
      try { return fs.statSync(`${codeDir}/${f}`).isFile(); } catch { return false; }
    });
    if (existingFiles.length > 0) {
      parts.push(`## ⚠ Files already on disk (from previous modules)`);
      parts.push('These files exist from an earlier module. Read them first, then update/replace with your complete version.');
      for (const f of existingFiles) {
        parts.push(`- ${codeDir}/${f}`);
      }
      parts.push('');
    }

    // Tech stack context
    parts.push(`## Tech Stack`);
    parts.push(`Language: ${plan.tech_stack.language}`);
    parts.push(`Framework: ${plan.tech_stack.framework}`);
    parts.push(`Build tool: ${plan.tech_stack.build_tool}`);
    parts.push('');

    // Already built files for import reference
    if (builtModules.size > 0) {
      const builtFiles = this.listBuiltFiles(codeDir);
      if (builtFiles.length > 0) {
        parts.push(`## Already Built Files (available for import)`);
        for (const f of builtFiles) {
          parts.push(`- ${f}`);
        }
        parts.push('');
      }
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

  // ─── User Confirmation ──────────────────────────────────────

  /**
   * Ask user whether to continue retrying a failed module.
   * If no InteractionHandler (e.g. auto-approve mode), defaults to skip.
   */
  private async askUserToRetry(moduleName: string, attempts: number, errors: string): Promise<boolean> {
    if (!this.interactionHandler) {
      // No interaction handler (auto-approve or MCP mode) — skip after AUTO_FIX_RETRIES
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
    builtModules: Set<string>,
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

    this.logger.agent(this.stage, 'info', 'builder:build-fix-start', {});

    await this.provider.call(prompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: BUILD_FIX_TIMEOUT_MS,
    });

    this.logger.agent(this.stage, 'info', 'builder:build-fix-complete', {});
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

  // ─── Disk Reuse Helpers ─────────────────────────────────────

  private loadExistingModules(plan: CodePlan): Set<string> {
    const codeDir = `${getArtifactsDir()}/code`;
    const built = new Set<string>();

    for (const mod of plan.modules) {
      const allFilesExist = mod.files.every(f =>
        fs.existsSync(`${codeDir}/${f}`)
      );
      if (allFilesExist) {
        built.add(mod.name);
      }
    }

    if (built.size > 0) {
      this.logger.agent(this.stage, 'info', 'disk:existing-modules', {
        built: Array.from(built),
        total: plan.modules.length,
      });
    }

    return built;
  }

  private getModulesToBuild(
    plan: CodePlan,
    builtModules: Set<string>,
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
          this.logger.agent(this.stage, 'info', 'builder:targeted-rebuild', {
            failedModules: Array.from(failedModules),
          });
          return plan.modules.filter(m => failedModules.has(m.name));
        }
      } catch {
        // If test_failures isn't valid JSON, fall through to normal rebuild
      }
    }

    return plan.modules.filter(m => !builtModules.has(m.name));
  }

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
      // Fallback: try to find raw JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? jsonMatch[0] : null;
    }
    return content.slice(startIdx + startTag.length, endIdx).trim();
  }

  // ─── Manifest Generation ───────────────────────────────────

  private generateManifest(plan: CodePlan): void {
    const codeDir = `${getArtifactsDir()}/code`;
    const allFiles = this.listBuiltFiles(codeDir);

    // Map files to modules
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

    // --- Project Summary (from intent-brief.json if available) ---
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

    // --- Features (from prd.manifest.json if available) ---
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

    // --- Tech Stack ---
    lines.push('## Tech Stack');
    lines.push('');
    lines.push(`| Layer | Technology |`);
    lines.push(`|---|---|`);
    lines.push(`| Language | ${plan.tech_stack.language} |`);
    lines.push(`| Framework | ${plan.tech_stack.framework} |`);
    lines.push(`| Build Tool | ${plan.tech_stack.build_tool} |`);
    lines.push('');

    // --- Quick Start ---
    lines.push('## Quick Start');
    lines.push('');
    lines.push('```bash');
    lines.push(plan.commands.setupCommand);
    lines.push(plan.commands.buildCommand);
    lines.push('```');
    lines.push('');

    // --- Module Architecture (Mermaid dependency graph) ---
    const nonScaffoldModules = plan.modules.filter(m => m.priority > 0);
    if (nonScaffoldModules.length > 1) {
      lines.push('## Architecture');
      lines.push('');
      lines.push('```mermaid');
      lines.push('graph TD');

      // Nodes with descriptions
      for (const mod of nonScaffoldModules) {
        const label = `${mod.name}["${mod.name}<br/><small>${this.escapeForMermaid(mod.description)}</small>"]`;
        lines.push(`  ${label}`);
      }

      // Edges from dependencies
      for (const mod of nonScaffoldModules) {
        for (const dep of mod.dependencies) {
          if (dep === 'scaffold') continue; // skip scaffold edges for clarity
          lines.push(`  ${dep} --> ${mod.name}`);
        }
      }

      lines.push('```');
      lines.push('');
    }

    // --- Modules Table ---
    lines.push('## Modules');
    lines.push('');
    lines.push('| Module | Description | Files | Features |');
    lines.push('|---|---|---|---|');
    for (const mod of plan.modules) {
      const features = mod.covers_features.join(', ') || '—';
      lines.push(`| ${mod.name} | ${mod.description} | ${mod.files.length} | ${features} |`);
    }
    lines.push('');

    // --- Project Directory Tree ---
    lines.push('## Project Structure');
    lines.push('');
    lines.push('```');
    const tree = this.buildDirectoryTree(codeDir, 3);
    lines.push(tree);
    lines.push('```');
    lines.push('');

    // --- Footer ---
    lines.push('---');
    lines.push('');
    lines.push('_Generated by [Mosaicat](https://github.com/ZB-ur/mosaicat) pipeline_');

    // Write to code directory
    const readmeContent = lines.join('\n');
    fs.writeFileSync(`${codeDir}/README.md`, readmeContent, 'utf-8');

    // Also write as an artifact for the pipeline
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

  /**
   * Build a visual directory tree string, limited to maxDepth.
   * Skips node_modules, dist, .turbo, etc.
   */
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

      // Sort: directories first, then files
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
