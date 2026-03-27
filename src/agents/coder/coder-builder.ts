import fs from 'node:fs';
import type { AgentContext } from '../../core/types.js';
import type { CodePlan, CodePlanModule } from '../code-plan-schema.js';
import type { CoderDeps } from './types.js';
import { listBuiltFiles } from './utils.js';

const SKELETON_PROMPT_PATH = '.claude/agents/mosaic/code-skeleton.md';
export const BUILDER_PROMPT_PATH = '.claude/agents/mosaic/code-builder.md';

/** Skeleton phase: 10 min -- writes all files */
const SKELETON_TIMEOUT_MS = 600_000;
/** Skeleton budget */
const SKELETON_BUDGET_USD = 2.00;
/** Per-module implement timeout: 5 minutes */
const MODULE_TIMEOUT_MS = 300_000;
/** Build fix timeout: 10 minutes */
const BUILD_FIX_TIMEOUT_MS = 600_000;

/**
 * CoderBuilder handles skeleton generation and per-module implementation.
 * Extracted from CoderAgent skeleton + implement methods.
 */
export class CoderBuilder {
  constructor(private readonly deps: CoderDeps) {}

  /**
   * Generate project skeleton via LLM with tool use.
   * Extracted from CoderAgent.runSkeleton() (coder.ts lines 433-485).
   */
  async runSkeleton(context: AgentContext, plan: CodePlan): Promise<void> {
    const skeletonPrompt = fs.readFileSync(SKELETON_PROMPT_PATH, 'utf-8');
    const codeDir = `${this.deps.artifacts.getDir()}/code`;

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

    this.deps.logger.agent(this.deps.stage, 'info', 'skeleton:start', {
      promptLength: userPrompt.length,
      totalFiles: allFiles.length,
    });
    this.deps.eventBus.emit('agent:thinking', this.deps.stage, userPrompt.length);
    this.deps.eventBus.emit('agent:progress', this.deps.stage, `skeleton: writing ${allFiles.length} files...`);

    const response = await this.deps.provider.call(userPrompt, {
      systemPrompt: skeletonPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: SKELETON_BUDGET_USD,
      timeoutMs: SKELETON_TIMEOUT_MS,
    });

    this.deps.eventBus.emit('agent:response', this.deps.stage, response.content.length);
    this.deps.logger.agent(this.deps.stage, 'info', 'skeleton:complete', {
      totalFiles: allFiles.length,
    });
  }

  /**
   * Check if all skeleton files already exist on disk (retry/resume scenario).
   * Extracted from CoderAgent.isSkeletonComplete() (coder.ts lines 490-495).
   */
  isSkeletonComplete(plan: CodePlan): boolean {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    return plan.modules.every(mod =>
      mod.files.every(f => fs.existsSync(`${codeDir}/${f}`))
    );
  }

  /**
   * Fix skeleton compilation errors -- single attempt.
   * Extracted from CoderAgent.runSkeletonFix() (coder.ts lines 500-547).
   */
  async runSkeletonFix(
    context: AgentContext,
    plan: CodePlan,
    errors: string,
    budgetUsd: number,
  ): Promise<void> {
    const skeletonPrompt = fs.readFileSync(SKELETON_PROMPT_PATH, 'utf-8');
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
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

    this.deps.logger.agent(this.deps.stage, 'info', 'skeleton:fix-start', {
      errorFiles: errorFiles.length,
    });

    await this.deps.provider.call(fixPrompt, {
      systemPrompt: skeletonPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: BUILD_FIX_TIMEOUT_MS,
    });

    this.deps.logger.agent(this.deps.stage, 'info', 'skeleton:fix-complete', {});
  }

  /**
   * Determine which modules need implementation.
   * On test-failure retarget: only rebuild modules with failing tests.
   * Otherwise: all modules.
   * Extracted from CoderAgent.getModulesToImplement() (coder.ts lines 703-728).
   */
  getModulesToImplement(
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
          this.deps.logger.agent(this.deps.stage, 'info', 'implement:targeted-rebuild', {
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

  /**
   * Implement a single module via LLM.
   * Extracted from CoderAgent.implementModule() (coder.ts lines 551-579).
   */
  async implementModule(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    budgetUsd: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const userPrompt = this.buildImplementPrompt(context, plan, mod);

    this.deps.logger.agent(this.deps.stage, 'info', 'implement:module-start', {
      module: mod.name,
      files: mod.files.length,
      priority: mod.priority,
    });
    this.deps.eventBus.emit('agent:thinking', this.deps.stage, userPrompt.length);

    const response = await this.deps.provider.call(userPrompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });

    this.deps.eventBus.emit('agent:response', this.deps.stage, response.content.length);

    this.deps.logger.agent(this.deps.stage, 'info', 'implement:module-complete', {
      module: mod.name,
    });
  }

  /**
   * Implement a module with error context for fix attempts.
   * Extracted from CoderAgent.implementModuleWithErrors() (coder.ts lines 581-641).
   */
  async implementModuleWithErrors(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
    budgetUsd: number,
    errors: string,
    retryNumber: number,
  ): Promise<void> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
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

    this.deps.logger.agent(this.deps.stage, 'info', 'implement:fix-start', {
      module: mod.name,
      retry: retryNumber,
      errorFiles: errorFiles.length,
    });
    this.deps.eventBus.emit('agent:thinking', this.deps.stage, errorPrompt.length);

    const response = await this.deps.provider.call(errorPrompt, {
      systemPrompt: builderPrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: budgetUsd,
      timeoutMs: MODULE_TIMEOUT_MS,
    });

    this.deps.eventBus.emit('agent:response', this.deps.stage, response.content.length);

    this.deps.logger.agent(this.deps.stage, 'info', 'implement:fix-complete', {
      module: mod.name,
      retry: retryNumber,
    });
  }

  /**
   * Build the implementation prompt for a module.
   * Extracted from CoderAgent.buildImplementPrompt() (coder.ts lines 643-695).
   */
  private buildImplementPrompt(
    context: AgentContext,
    plan: CodePlan,
    mod: CodePlanModule,
  ): string {
    const codeDir = `${this.deps.artifacts.getDir()}/code`;
    const parts: string[] = [];

    parts.push(`## Module: ${mod.name}`);
    parts.push(`Description: ${mod.description}`);
    parts.push(`Working directory: ${codeDir}`);
    parts.push('');

    // List files to implement -- these already exist as skeletons
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
    const builtFiles = listBuiltFiles(codeDir);
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
   * Extract file paths from compiler error output.
   * Extracted from CoderAgent.extractErrorFiles() (coder.ts lines 1069-1083).
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
}
