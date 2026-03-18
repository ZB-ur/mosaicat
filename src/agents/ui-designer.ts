import fs from 'node:fs';
import path from 'node:path';
import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import type { LLMUsage } from '../core/llm-provider.js';
import type { ReviewComment } from '../core/types.js';
import { readArtifact, artifactExists } from '../core/artifact.js';
import { UIPlanSchema, type UIPlan, type UIPlanComponent } from './ui-plan-schema.js';

const PLANNER_PROMPT_PATH = '.claude/agents/mosaic/ui-planner.md';
const BUILDER_PROMPT_PATH = '.claude/agents/mosaic/ui-builder.md';

/** Max sibling components to include as full tsx source for consistency */
const FULL_SIBLING_COUNT = 2;
/** Max lines of summary for siblings beyond the first two */
const SIBLING_SUMMARY_LINES = 15;

export class UIDesignerAgent extends BaseAgent {
  private totalUsage: LLMUsage = { input_tokens: 0, output_tokens: 0 };

  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['components/', 'previews/', 'gallery.html'],
      manifest: 'components.manifest.json',
    };
  }

  private accumulateUsage(usage?: LLMUsage): void {
    if (!usage) return;
    this.totalUsage.input_tokens += usage.input_tokens;
    this.totalUsage.output_tokens += usage.output_tokens;
    if (usage.cache_creation_input_tokens) {
      this.totalUsage.cache_creation_input_tokens =
        (this.totalUsage.cache_creation_input_tokens ?? 0) + usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens) {
      this.totalUsage.cache_read_input_tokens =
        (this.totalUsage.cache_read_input_tokens ?? 0) + usage.cache_read_input_tokens;
    }
    if (usage.cost_usd != null) {
      this.totalUsage.cost_usd = (this.totalUsage.cost_usd ?? 0) + usage.cost_usd;
    }
  }

  protected async run(context: AgentContext): Promise<void> {
    this.totalUsage = { input_tokens: 0, output_tokens: 0 };

    // Check for partial retry
    const retryComponentsRaw = context.inputArtifacts.get('retry_components');
    const retryComponents = retryComponentsRaw ? JSON.parse(retryComponentsRaw) as string[] : undefined;
    const feedback = context.inputArtifacts.get('rejection_feedback');
    const reviewCommentsRaw = context.inputArtifacts.get('review_comments');
    const reviewComments: ReviewComment[] | undefined = reviewCommentsRaw
      ? JSON.parse(reviewCommentsRaw)
      : undefined;

    if (retryComponents && retryComponents.length > 0) {
      // Partial retry: skip planner, only rebuild specified components
      await this.runPartialRetry(context, retryComponents, reviewComments);
    } else {
      // Full run (or full retry with feedback injected into planner)
      const plan = await this.runPlanner(context);
      const builtComponents = await this.runBuilders(context, plan);
      await this.postProcess(plan, builtComponents);
    }

    // Emit accumulated usage for entire UIDesigner stage
    if (this.totalUsage.input_tokens > 0 || this.totalUsage.output_tokens > 0) {
      eventBus.emit('agent:usage', this.stage, this.totalUsage);
    }
  }

  private async runPartialRetry(
    context: AgentContext,
    retryComponents: string[],
    reviewComments?: ReviewComment[],
  ): Promise<void> {
    // Load existing plan from disk
    if (!artifactExists('ui-plan.json')) {
      throw new Error('Cannot partial retry: ui-plan.json not found on disk');
    }
    const planJson = readArtifact('ui-plan.json');
    const plan = UIPlanSchema.parse(JSON.parse(planJson));

    this.logger.agent(this.stage, 'info', 'partial-retry:start', {
      retryComponents,
      totalComponents: plan.components.length,
    });

    // Load existing built components from disk (preserve unchanged ones)
    const builtComponents = new Map<string, string>();
    for (const comp of plan.components) {
      if (artifactExists(comp.file)) {
        builtComponents.set(comp.name, readArtifact(comp.file));
      }
    }

    // Only rebuild specified components
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const previewFiles: string[] = [];

    for (const compName of retryComponents) {
      const comp = plan.components.find((c) => c.name === compName);
      if (!comp) {
        this.logger.agent(this.stage, 'warn', 'partial-retry:component-not-found', {
          component: compName,
        });
        continue;
      }

      // Build feedback section for this component
      const compComments = reviewComments?.filter(
        (c) => c.file === comp.file || c.file.includes(compName)
      );
      const feedbackSection = this.buildComponentFeedback(compName, compComments);

      const userPrompt = this.buildBuilderUserPrompt(context, plan, comp, builtComponents)
        + (feedbackSection ? `\n\n${feedbackSection}` : '');

      this.logger.agent(this.stage, 'info', 'builder:call', {
        component: comp.name,
        promptLength: userPrompt.length,
        isRetry: true,
      });
      eventBus.emit('agent:thinking', this.stage, userPrompt.length);

      try {
        const response = await this.provider.call(userPrompt, {
          systemPrompt: builderPrompt,
        });
        const raw = response.content;
        this.accumulateUsage(response.usage);

        // Extract artifacts (same logic as runBuilders)
        const artifactPattern = /<!-- ARTIFACT:([\S]+) -->\s*([\s\S]*?)\s*<!-- END:\1 -->/g;
        let match;
        while ((match = artifactPattern.exec(raw)) !== null) {
          const name = match[1];
          const content = match[2].trim()
            .replace(/^```(?:tsx|html|json)?\s*\n?/, '')
            .replace(/\n?```\s*$/, '');
          this.writeOutput(name, content);

          if (name === comp.file) {
            builtComponents.set(comp.name, content);
          }
          if (name === comp.preview) {
            previewFiles.push(name);
          }
        }

        this.logger.agent(this.stage, 'info', 'builder:complete', {
          component: comp.name,
          isRetry: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.agent(this.stage, 'warn', 'builder:failed', {
          component: comp.name,
          error: message,
          isRetry: true,
        });
      }
    }

    (this as { _previewFiles?: string[] })._previewFiles = previewFiles;
    await this.postProcess(plan, builtComponents);
  }

  private buildComponentFeedback(
    componentName: string,
    comments?: ReviewComment[],
  ): string | null {
    if (!comments || comments.length === 0) return null;

    const lines = comments.map((c) => {
      const lineRef = c.line ? `Line ${c.line}: ` : '';
      return `- ${lineRef}${c.body}`;
    });

    return `## Reviewer Feedback for ${componentName}\n\n${lines.join('\n')}\n\nPlease modify the component according to the feedback above. Keep other parts unchanged.`;
  }

  private async runPlanner(context: AgentContext): Promise<UIPlan> {
    const plannerPrompt = fs.readFileSync(PLANNER_PROMPT_PATH, 'utf-8');
    const userPrompt = this.buildPlannerUserPrompt(context);

    this.logger.agent(this.stage, 'info', 'planner:call', {
      promptLength: userPrompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: plannerPrompt,
    });
    const raw = response.content;
    this.accumulateUsage(response.usage);

    this.logger.agent(this.stage, 'info', 'planner:response', {
      responseLength: raw.length,
      usage: response.usage,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Check for clarification
    const clarificationMatch = raw.match(
      /<!-- CLARIFICATION -->\s*([\s\S]*?)\s*<!-- END:CLARIFICATION -->/
    );
    if (clarificationMatch) {
      const content = clarificationMatch[1].trim();
      // Try structured JSON clarification
      try {
        const parsed = JSON.parse(content);
        if (parsed.question && parsed.options) {
          eventBus.emit('agent:clarification', this.stage, parsed.question);
          throw new ClarificationNeeded(
            parsed.question,
            parsed.options,
            parsed.allow_custom ?? true
          );
        }
      } catch (err) {
        if (err instanceof ClarificationNeeded) throw err;
      }
      // Fallback: plain text clarification
      eventBus.emit('agent:clarification', this.stage, content);
      throw new ClarificationNeeded(content);
    }

    // Extract ui-plan.json artifact
    const artifactMatch = raw.match(
      /<!-- ARTIFACT:ui-plan\.json -->\s*([\s\S]*?)\s*<!-- END:ui-plan\.json -->/
    );
    if (!artifactMatch) {
      throw new Error('UIPlanner did not produce ui-plan.json artifact');
    }

    let jsonStr = artifactMatch[1].trim()
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?\s*```\s*$/, '');

    // LLM may wrap JSON in extra text — extract the JSON object/array
    const jsonObjectMatch = jsonStr.match(/(\{[\s\S]*\})/);
    if (jsonObjectMatch) {
      jsonStr = jsonObjectMatch[1];
    }

    let planData: unknown;
    try {
      planData = JSON.parse(jsonStr);
    } catch (parseErr) {
      this.logger.agent(this.stage, 'error', 'planner:json-parse-failed', {
        rawContent: jsonStr.slice(0, 500),
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      throw new Error('Failed to parse ui-plan.json JSON from planner response');
    }

    const plan = UIPlanSchema.parse(planData);
    this.writeOutput('ui-plan.json', JSON.stringify(plan, null, 2));

    this.logger.agent(this.stage, 'info', 'planner:complete', {
      componentCount: plan.components.length,
    });

    return plan;
  }

  private async runBuilders(
    context: AgentContext,
    plan: UIPlan,
  ): Promise<Map<string, string>> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const sorted = [...plan.components].sort((a, b) => a.priority - b.priority);
    const builtComponents = new Map<string, string>(); // name → tsx content
    const previewFiles: string[] = [];

    for (const comp of sorted) {
      try {
        const userPrompt = this.buildBuilderUserPrompt(
          context, plan, comp, builtComponents
        );

        this.logger.agent(this.stage, 'info', 'builder:call', {
          component: comp.name,
          promptLength: userPrompt.length,
        });
        eventBus.emit('agent:thinking', this.stage, userPrompt.length);

        const response = await this.provider.call(userPrompt, {
          systemPrompt: builderPrompt,
        });
        const raw = response.content;
        this.accumulateUsage(response.usage);

        this.logger.agent(this.stage, 'info', 'builder:response', {
          component: comp.name,
          responseLength: raw.length,
          usage: response.usage,
        });

        // Extract tsx and html artifacts
        const artifactPattern = /<!-- ARTIFACT:([\S]+) -->\s*([\s\S]*?)\s*<!-- END:\1 -->/g;
        let match;
        let tsxWritten = false;
        let htmlWritten = false;

        while ((match = artifactPattern.exec(raw)) !== null) {
          const name = match[1];
          // Strip markdown code fences that LLM may wrap around content
          const content = match[2].trim()
            .replace(/^```(?:tsx|html|json)?\s*\n?/, '')
            .replace(/\n?```\s*$/, '');
          this.writeOutput(name, content);

          if (name === comp.file) {
            builtComponents.set(comp.name, content);
            tsxWritten = true;
          }
          if (name === comp.preview) {
            previewFiles.push(name);
            htmlWritten = true;
          }
        }

        if (!tsxWritten) {
          this.logger.agent(this.stage, 'warn', 'builder:missing-tsx', {
            component: comp.name,
            expected: comp.file,
          });
        }
        if (!htmlWritten) {
          this.logger.agent(this.stage, 'warn', 'builder:missing-html', {
            component: comp.name,
            expected: comp.preview,
          });
        }

        this.logger.agent(this.stage, 'info', 'builder:complete', {
          component: comp.name,
        });
      } catch (err) {
        // Single component failure does not abort the whole agent
        const message = err instanceof Error ? err.message : String(err);
        this.logger.agent(this.stage, 'warn', 'builder:failed', {
          component: comp.name,
          error: message,
        });
      }
    }

    // Store preview files for post-processing
    (this as { _previewFiles?: string[] })._previewFiles = previewFiles;

    return builtComponents;
  }

  private async postProcess(
    plan: UIPlan,
    builtComponents: Map<string, string>,
  ): Promise<void> {
    const previewFiles = (this as { _previewFiles?: string[] })._previewFiles ?? [];

    // Render screenshots from preview HTML files
    if (previewFiles.length > 0) {
      await this.renderPreviewsAndGallery(previewFiles);
    }

    // Programmatically generate manifest from plan + actual written files
    const components = plan.components
      .filter((c) => builtComponents.has(c.name))
      .map((c) => ({
        name: c.name,
        file: c.file,
        covers_flow: c.covers_flow,
      }));

    const screenshots = components.map(
      (c) => `screenshots/${c.name}.png`
    );
    const previews = previewFiles;

    const manifestData: {
      components: { name: string; file: string; covers_flow: string }[];
      screenshots: string[];
      previews: string[];
    } = {
      components,
      screenshots,
      previews,
    };

    this.writeOutputManifest('components.manifest.json', manifestData);

    this.logger.agent(this.stage, 'info', 'manifest:generated', {
      componentCount: components.length,
      screenshotCount: screenshots.length,
      previewCount: previews.length,
    });
  }

  private buildPlannerUserPrompt(context: AgentContext): string {
    const sections: string[] = [];

    sections.push(`## Task\n${context.task.instruction}`);

    // Include input artifacts
    for (const [name, content] of context.inputArtifacts) {
      sections.push(`## ${name}\n${content}`);
    }

    sections.push(`## Output Requirements
Produce a single ARTIFACT block containing the component plan as JSON:

\`<!-- ARTIFACT:ui-plan.json -->\`
...JSON...
\`<!-- END:ui-plan.json -->\`

If you need clarification about design direction, use a CLARIFICATION block instead (no artifacts).`);

    return sections.join('\n\n');
  }

  private buildBuilderUserPrompt(
    context: AgentContext,
    plan: UIPlan,
    comp: UIPlanComponent,
    builtComponents: Map<string, string>,
  ): string {
    const sections: string[] = [];

    // Component spec
    sections.push(`## Component to Build\n\`\`\`json\n${JSON.stringify(comp, null, 2)}\n\`\`\``);

    // Design tokens
    if (plan.design_tokens) {
      sections.push(`## Design Tokens\n\`\`\`json\n${JSON.stringify(plan.design_tokens, null, 2)}\n\`\`\``);
    }

    // API spec for data binding context
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec) {
      sections.push(`## API Specification\n${apiSpec}`);
    }

    // Sibling context for consistency
    if (builtComponents.size > 0) {
      const siblingEntries = Array.from(builtComponents.entries());
      const siblingSections: string[] = [];

      for (let i = 0; i < siblingEntries.length; i++) {
        const [name, tsx] = siblingEntries[i];
        if (i < FULL_SIBLING_COUNT) {
          // Full source for first N siblings
          siblingSections.push(`### ${name} (full)\n\`\`\`tsx\n${tsx}\n\`\`\``);
        } else {
          // Summary only: component name + first N lines
          const lines = tsx.split('\n');
          const summary = lines.slice(0, SIBLING_SUMMARY_LINES).join('\n');
          siblingSections.push(`### ${name} (summary)\n\`\`\`tsx\n${summary}\n// ... (${lines.length - SIBLING_SUMMARY_LINES} more lines)\n\`\`\``);
        }
      }

      sections.push(`## Already Built Components (for consistency)\n${siblingSections.join('\n\n')}`);
    }

    // Output requirements
    sections.push(`## Output Requirements
Produce exactly 2 ARTIFACT blocks:

\`<!-- ARTIFACT:${comp.file} -->\`
...React component code...
\`<!-- END:${comp.file} -->\`

\`<!-- ARTIFACT:${comp.preview} -->\`
...Self-contained HTML preview...
\`<!-- END:${comp.preview} -->\``);

    return sections.join('\n\n');
  }

  private async renderPreviewsAndGallery(previewFiles: string[]): Promise<void> {
    try {
      const { renderPreviewScreenshots, generateGallery } = await import('../core/screenshot-renderer.js');
      const results = await renderPreviewScreenshots(previewFiles, '.mosaic/artifacts');
      this.logger.agent(this.stage, 'info', 'screenshots:rendered', {
        count: results.length,
        files: results.map((r) => r.screenshotPath),
      });

      if (results.length > 0) {
        const galleryPath = generateGallery(results, '.mosaic/artifacts');
        this.logger.agent(this.stage, 'info', 'gallery:generated', {
          path: galleryPath,
        });
      }
    } catch (err) {
      this.logger.agent(this.stage, 'warn', 'screenshots:skipped', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
