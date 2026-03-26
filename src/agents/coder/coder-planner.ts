import fs from 'node:fs';
import type { AgentContext } from '../../core/types.js';
import { CodePlanSchema, type CodePlan } from '../code-plan-schema.js';
import type { CoderDeps } from './types.js';

const PLANNER_PROMPT_PATH = '.claude/agents/mosaic/code-planner.md';
const PLANNER_BUDGET_USD = 0.50;

/**
 * CoderPlanner generates a code-plan.json from LLM analysis of the tech spec.
 * Extracted from CoderAgent.runPlanner().
 */
export class CoderPlanner {
  constructor(private readonly deps: CoderDeps) {}

  /**
   * Call LLM to produce a code-plan.json, parse it, write to artifacts, return.
   * Extracted from CoderAgent.runPlanner() (coder.ts lines 392-429).
   */
  async createPlan(context: AgentContext): Promise<CodePlan> {
    const plannerPrompt = fs.readFileSync(PLANNER_PROMPT_PATH, 'utf-8');

    const parts: string[] = ['## Task\nAnalyze the technical specification and produce a code-plan.json.\n'];
    const techSpec = context.inputArtifacts.get('tech-spec.md');
    if (techSpec) parts.push(`## tech-spec.md\n${techSpec}\n`);
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec) parts.push(`## api-spec.yaml\n${apiSpec}\n`);

    const userPrompt = parts.join('\n');

    this.deps.logger.agent(this.deps.stage, 'info', 'planner:start', {
      promptLength: userPrompt.length,
    });
    this.deps.eventBus.emit('agent:thinking', this.deps.stage, userPrompt.length);

    const response = await this.deps.provider.call(userPrompt, {
      systemPrompt: plannerPrompt,
      maxBudgetUsd: PLANNER_BUDGET_USD,
    });

    this.deps.eventBus.emit('agent:response', this.deps.stage, response.content.length);

    const planJson = this.extractArtifact(response.content, 'code-plan.json');
    if (!planJson) {
      throw new Error('Planner did not produce a code-plan.json ARTIFACT block');
    }

    const plan = CodePlanSchema.parse(JSON.parse(planJson));

    // Write to artifact store + emit events (replaces BaseAgent.writeOutput)
    const planContent = JSON.stringify(plan, null, 2);
    this.deps.artifacts.write('code-plan.json', planContent);
    this.deps.logger.agent(this.deps.stage, 'info', 'artifact:written', { name: 'code-plan.json' });
    this.deps.eventBus.emit('artifact:written', this.deps.stage, 'code-plan.json', planContent.length);

    this.deps.logger.agent(this.deps.stage, 'info', 'planner:complete', {
      modules: plan.modules.length,
      totalFiles: plan.modules.reduce((sum, m) => sum + m.files.length, 0),
    });

    return plan;
  }

  /**
   * Check if code-plan.json already exists and return it (resume/retry scenario).
   * Extracted from CoderAgent.run() plan reuse logic (coder.ts lines 85-89).
   */
  loadExistingPlan(): CodePlan | null {
    if (!this.deps.artifacts.exists('code-plan.json')) {
      return null;
    }
    const raw = this.deps.artifacts.read('code-plan.json');
    const plan = CodePlanSchema.parse(JSON.parse(raw));
    this.deps.logger.agent(this.deps.stage, 'info', 'planner:reuse', {
      modules: plan.modules.length,
    });
    return plan;
  }

  /**
   * Extract an artifact block from LLM response content.
   * Looks for <!-- ARTIFACT:name --> ... <!-- END:name --> markers.
   * Falls back to extracting raw JSON if markers not found.
   */
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
}
