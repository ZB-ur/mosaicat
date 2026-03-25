import fs from 'node:fs';
import type { AgentContext, StageName } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { LLMProvider } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { readArtifact, artifactExists, getArtifactsDir } from '../core/artifact.js';
import { CodePlanSchema } from './code-plan-schema.js';

const REFINE_PROMPT_PATH = '.claude/agents/mosaic/refine.md';
const REFINE_TIMEOUT_MS = 600_000;
const REFINE_BUDGET_USD = 3.00;

/**
 * Refine Agent — diagnoses and fixes issues in generated code based on user feedback.
 *
 * Not a pipeline stage — invoked standalone via `mosaicat refine`.
 * Reads user_feedback from context.inputArtifacts, loads code-plan.json and tech-spec.md,
 * then uses LLM with Read/Write/Bash tools to diagnose and fix.
 */
export class RefineAgent extends BaseAgent {
  constructor(
    provider: LLMProvider,
    logger: Logger,
  ) {
    // Use 'coder' as the stage for logging purposes
    super('coder' as StageName, provider, logger);
  }

  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['code/'],
      manifest: undefined,
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const refinePrompt = fs.readFileSync(REFINE_PROMPT_PATH, 'utf-8');
    const codeDir = `${getArtifactsDir()}/code`;

    const userFeedback = context.inputArtifacts.get('user_feedback');
    if (!userFeedback) {
      throw new Error('RefineAgent requires user_feedback in inputArtifacts');
    }

    // Build the user prompt
    const parts: string[] = [];
    parts.push('## User Feedback');
    parts.push(userFeedback);
    parts.push('');
    parts.push(`## Code Directory\n${codeDir}`);
    parts.push('');

    // Load code-plan.json for structure context
    if (artifactExists('code-plan.json')) {
      const planRaw = readArtifact('code-plan.json');
      const plan = CodePlanSchema.parse(JSON.parse(planRaw));
      parts.push('## code-plan.json');
      parts.push('```json');
      parts.push(JSON.stringify(plan, null, 2));
      parts.push('```');
      parts.push('');
      parts.push(`## Verify Command\n\`${plan.commands.verifyCommand}\``);
      parts.push(`## Build Command\n\`${plan.commands.buildCommand}\``);
      parts.push('');
    }

    // Load constitution for constraints
    if (artifactExists('constitution.project.md')) {
      const constitution = readArtifact('constitution.project.md');
      parts.push(`## Project Constitution (DO NOT VIOLATE)\n${constitution}\n`);
    }

    // Load tech-spec for expected behavior
    if (artifactExists('tech-spec.md')) {
      const techSpec = readArtifact('tech-spec.md');
      parts.push(`## tech-spec.md\n${techSpec}\n`);
    }

    // List all code files for reference
    const codeFiles = this.listCodeFiles(codeDir);
    if (codeFiles.length > 0) {
      parts.push('## Project Files');
      for (const f of codeFiles) {
        parts.push(`- ${codeDir}/${f}`);
      }
      parts.push('');
    }

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'refine:start', {
      feedbackLength: userFeedback.length,
      promptLength: userPrompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);
    eventBus.emit('agent:progress', this.stage, 'refine: diagnosing and fixing...');

    const response = await this.provider.call(userPrompt, {
      systemPrompt: refinePrompt,
      allowedTools: ['Read', 'Write', 'Bash'],
      maxBudgetUsd: REFINE_BUDGET_USD,
      timeoutMs: REFINE_TIMEOUT_MS,
    });

    eventBus.emit('agent:response', this.stage, response.content.length);
    this.logger.agent(this.stage, 'info', 'refine:complete', {});
  }

  private listCodeFiles(codeDir: string): string[] {
    const files: string[] = [];
    try {
      this.walkDir(codeDir, codeDir, files);
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
