import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
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
/** Max compile-fix retries per module */
const MAX_MODULE_FIX_RETRIES = 2;

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
        await this.buildModule(context, plan, scaffoldModule, builtModules, perModuleBudget);
        builtModules.add(scaffoldModule.name);
        this.runSetupCommand(plan);
      }

      // Step 4: Build remaining modules by priority
      const nonScaffold = modulesToBuild
        .filter(m => m.priority !== 0)
        .sort((a, b) => a.priority - b.priority);

      for (const mod of nonScaffold) {
        await this.buildModule(context, plan, mod, builtModules, perModuleBudget);
        builtModules.add(mod.name);

        // Verify after each module
        const verifyResult = this.runVerifyCommand(plan);
        if (!verifyResult.success) {
          // Try to fix compilation errors
          let fixed = false;
          for (let retry = 0; retry < MAX_MODULE_FIX_RETRIES; retry++) {
            this.logger.agent(this.stage, 'warn', 'builder:verify-failed', {
              module: mod.name,
              retry: retry + 1,
              errors: verifyResult.errors.slice(0, 500),
            });

            await this.buildModuleWithErrors(
              context, plan, mod, builtModules, perModuleBudget, verifyResult.errors
            );

            const retryResult = this.runVerifyCommand(plan);
            if (retryResult.success) {
              fixed = true;
              break;
            }
          }

          if (!fixed) {
            this.logger.agent(this.stage, 'warn', 'builder:verify-gave-up', {
              module: mod.name,
            });
            // Continue to next module — don't block the pipeline
          }
        }
      }
    }

    // Step 5: Final build check
    const buildResult = this.runBuildCommand(plan);
    if (!buildResult.success) {
      this.logger.agent(this.stage, 'warn', 'builder:build-failed', {
        errors: buildResult.errors.slice(0, 1000),
      });
      // One fix attempt for build errors
      await this.runBuildFix(context, plan, builtModules, buildResult.errors, totalBudget * 0.2);
    }

    // Step 6: Generate manifest programmatically
    this.generateManifest(plan);
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
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const basePrompt = this.buildModulePrompt(context, plan, mod, builtModules);
    const errorPrompt = `${basePrompt}\n\n## Compilation Errors (fix these)\n\`\`\`\n${errors}\n\`\`\`\n\nFix the errors above. Only modify files that have errors. Do not rewrite files that compile correctly.`;

    this.logger.agent(this.stage, 'info', 'builder:fix-start', {
      module: mod.name,
    });

    await this.provider.call(errorPrompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd * 0.5,
      timeoutMs: MODULE_TIMEOUT_MS,
    });

    this.logger.agent(this.stage, 'info', 'builder:fix-complete', {
      module: mod.name,
    });
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
}
