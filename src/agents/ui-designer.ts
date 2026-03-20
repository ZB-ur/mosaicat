import fs from 'node:fs';
import path from 'node:path';
import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import type { ReviewComment } from '../core/types.js';
import { readArtifact, artifactExists } from '../core/artifact.js';
import { UIPlanSchema, type UIPlan, type UIPlanComponent } from './ui-plan-schema.js';
import { trimApiSpec } from './ui-api-trimmer.js';

const PLANNER_PROMPT_PATH = '.claude/agents/mosaic/ui-planner.md';
const BUILDER_PROMPT_PATH = '.claude/agents/mosaic/ui-builder.md';

/** Max sibling components to include as full tsx source for consistency */
const FULL_SIBLING_COUNT = 2;
/** Max lines of summary for siblings beyond the first two */
const SIBLING_SUMMARY_LINES = 15;
/** Max atomic components per batch */
const ATOMIC_BATCH_SIZE = 6;

export class UIDesignerAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['components/', 'previews/', 'gallery.html'],
      manifest: 'components.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
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
      const builtComponents = await this.runBatchBuilders(context, plan);
      await this.postProcess(plan, builtComponents);
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

    // Resolve retry component specs
    const retrySpecs: UIPlanComponent[] = [];
    for (const compName of retryComponents) {
      const comp = plan.components.find((c) => c.name === compName);
      if (!comp) {
        this.logger.agent(this.stage, 'warn', 'partial-retry:component-not-found', {
          component: compName,
        });
        continue;
      }
      retrySpecs.push(comp);
    }

    // Group retry components by category for batching
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const previewFiles: string[] = [];
    const retryBatches = this.createBatches(retrySpecs, plan);

    this.logger.agent(this.stage, 'info', 'partial-retry:batches', {
      totalRetry: retrySpecs.length,
      batchCount: retryBatches.length,
    });

    for (const batch of retryBatches) {
      // Build per-component feedback sections
      const feedbackMap = new Map<string, string>();
      for (const comp of batch) {
        const compComments = reviewComments?.filter(
          (c) => c.file === comp.file || c.file.includes(comp.name)
        );
        const feedback = this.buildComponentFeedback(comp.name, compComments);
        if (feedback) feedbackMap.set(comp.name, feedback);
      }

      if (batch.length === 1) {
        // Single component retry with feedback
        const comp = batch[0];
        const userPrompt = this.buildBuilderUserPrompt(context, plan, comp, builtComponents)
          + (feedbackMap.has(comp.name) ? `\n\n${feedbackMap.get(comp.name)}` : '');

        this.logger.agent(this.stage, 'info', 'builder:call', {
          component: comp.name,
          promptLength: userPrompt.length,
          isRetry: true,
        });
        eventBus.emit('agent:thinking', this.stage, userPrompt.length);

        try {
          const response = await this.provider.call(userPrompt, { systemPrompt: builderPrompt });
          this.extractAndWriteArtifacts(response.content, [comp], builtComponents, previewFiles);
          this.logger.agent(this.stage, 'info', 'builder:complete', { component: comp.name, isRetry: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.agent(this.stage, 'warn', 'builder:failed', { component: comp.name, error: message, isRetry: true });
        }
      } else {
        // Batch retry with per-component feedback appended
        const userPrompt = this.buildBatchBuilderUserPrompt(context, plan, batch, builtComponents)
          + this.buildBatchFeedbackSection(feedbackMap);

        const componentNames = batch.map(c => c.name);
        this.logger.agent(this.stage, 'info', 'builder:call', {
          components: componentNames,
          batchSize: batch.length,
          promptLength: userPrompt.length,
          isRetry: true,
        });
        eventBus.emit('agent:thinking', this.stage, userPrompt.length);

        try {
          const response = await this.provider.call(userPrompt, { systemPrompt: builderPrompt });
          const written = this.extractAndWriteArtifacts(response.content, batch, builtComponents, previewFiles);

          // Retry missing individually
          const missing = batch.filter(c => !written.has(c.name));
          for (const comp of missing) {
            const singlePrompt = this.buildBuilderUserPrompt(context, plan, comp, builtComponents)
              + (feedbackMap.has(comp.name) ? `\n\n${feedbackMap.get(comp.name)}` : '');
            try {
              const resp = await this.provider.call(singlePrompt, { systemPrompt: builderPrompt });
              this.extractAndWriteArtifacts(resp.content, [comp], builtComponents, previewFiles);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              this.logger.agent(this.stage, 'warn', 'builder:failed', { component: comp.name, error: message, isRetry: true });
            }
          }

          this.logger.agent(this.stage, 'info', 'builder:complete', { components: componentNames, isRetry: true });
        } catch (err) {
          // Batch failed — degrade to individual
          const message = err instanceof Error ? err.message : String(err);
          this.logger.agent(this.stage, 'warn', 'batch:fallback', { components: componentNames, error: message, isRetry: true });
          for (const comp of batch) {
            const singlePrompt = this.buildBuilderUserPrompt(context, plan, comp, builtComponents)
              + (feedbackMap.has(comp.name) ? `\n\n${feedbackMap.get(comp.name)}` : '');
            try {
              const resp = await this.provider.call(singlePrompt, { systemPrompt: builderPrompt });
              this.extractAndWriteArtifacts(resp.content, [comp], builtComponents, previewFiles);
            } catch (innerErr) {
              const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
              this.logger.agent(this.stage, 'warn', 'builder:failed', { component: comp.name, error: innerMsg, isRetry: true });
            }
          }
        }
      }
    }

    (this as { _previewFiles?: string[] })._previewFiles = previewFiles;
    await this.postProcess(plan, builtComponents);
  }

  /**
   * Build a combined feedback section for batch retry prompts.
   */
  private buildBatchFeedbackSection(feedbackMap: Map<string, string>): string {
    if (feedbackMap.size === 0) return '';
    const sections = [...feedbackMap.values()];
    return '\n\n' + sections.join('\n\n');
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

    this.logger.agent(this.stage, 'info', 'planner:response', {
      responseLength: raw.length,
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

  /**
   * Group components by category and build in batches to reduce LLM calls.
   * - atomic: batched in groups of ATOMIC_BATCH_SIZE
   * - composite: grouped by module or parent
   * - page: built individually (complex, full-context needed)
   */
  private async runBatchBuilders(
    context: AgentContext,
    plan: UIPlan,
  ): Promise<Map<string, string>> {
    const builderPrompt = fs.readFileSync(BUILDER_PROMPT_PATH, 'utf-8');
    const sorted = [...plan.components].sort((a, b) => a.priority - b.priority);
    const builtComponents = new Map<string, string>();
    const previewFiles: string[] = [];

    const batches = this.createBatches(sorted, plan);

    this.logger.agent(this.stage, 'info', 'batch:plan', {
      totalComponents: sorted.length,
      totalBatches: batches.length,
      breakdown: batches.map(b => ({ category: b[0]?.category ?? 'unknown', size: b.length })),
    });

    for (const batch of batches) {
      if (batch.length === 1) {
        // Single component — use original single-component flow
        await this.buildSingleComponent(context, plan, batch[0], builtComponents, previewFiles, builderPrompt);
      } else {
        // Multi-component batch
        try {
          await this.buildBatch(context, plan, batch, builtComponents, previewFiles, builderPrompt);
        } catch (err) {
          // Batch failed — degrade to per-component
          const message = err instanceof Error ? err.message : String(err);
          this.logger.agent(this.stage, 'warn', 'batch:fallback', {
            components: batch.map(c => c.name),
            error: message,
          });
          for (const comp of batch) {
            await this.buildSingleComponent(context, plan, comp, builtComponents, previewFiles, builderPrompt);
          }
        }
      }
    }

    (this as { _previewFiles?: string[] })._previewFiles = previewFiles;
    return builtComponents;
  }

  /**
   * Create batches from sorted components based on category.
   */
  private createBatches(sorted: UIPlanComponent[], plan: UIPlan): UIPlanComponent[][] {
    const atomic: UIPlanComponent[] = [];
    const composite: UIPlanComponent[] = [];
    const page: UIPlanComponent[] = [];

    for (const comp of sorted) {
      switch (comp.category) {
        case 'atomic': atomic.push(comp); break;
        case 'composite': composite.push(comp); break;
        case 'page': page.push(comp); break;
      }
    }

    const batches: UIPlanComponent[][] = [];

    // Atomic: fixed-size batches
    for (let i = 0; i < atomic.length; i += ATOMIC_BATCH_SIZE) {
      batches.push(atomic.slice(i, i + ATOMIC_BATCH_SIZE));
    }

    // Composite: group by module, fall back to parent
    const compositeGroups = this.groupComposites(composite, plan);
    batches.push(...compositeGroups);

    // Page: each is its own batch (built individually)
    for (const comp of page) {
      batches.push([comp]);
    }

    return batches;
  }

  /**
   * Group composite components by module membership, or by parent if no modules defined.
   */
  private groupComposites(composites: UIPlanComponent[], plan: UIPlan): UIPlanComponent[][] {
    if (composites.length === 0) return [];

    // Try module-based grouping first
    if (plan.modules && plan.modules.length > 0) {
      const moduleMap = new Map<string, UIPlanComponent[]>();
      const ungrouped: UIPlanComponent[] = [];

      for (const comp of composites) {
        const mod = plan.modules.find(m => m.components.includes(comp.name));
        if (mod) {
          if (!moduleMap.has(mod.name)) moduleMap.set(mod.name, []);
          moduleMap.get(mod.name)!.push(comp);
        } else {
          ungrouped.push(comp);
        }
      }

      const groups = [...moduleMap.values()];
      if (ungrouped.length > 0) groups.push(ungrouped);
      return groups;
    }

    // Fallback: group by parent
    const parentMap = new Map<string, UIPlanComponent[]>();
    for (const comp of composites) {
      const key = comp.parent ?? '__root__';
      if (!parentMap.has(key)) parentMap.set(key, []);
      parentMap.get(key)!.push(comp);
    }
    return [...parentMap.values()];
  }

  /**
   * Build a single component (original per-component flow).
   */
  private async buildSingleComponent(
    context: AgentContext,
    plan: UIPlan,
    comp: UIPlanComponent,
    builtComponents: Map<string, string>,
    previewFiles: string[],
    builderPrompt: string,
  ): Promise<void> {
    try {
      const userPrompt = this.buildBuilderUserPrompt(context, plan, comp, builtComponents);

      this.logger.agent(this.stage, 'info', 'builder:call', {
        component: comp.name,
        promptLength: userPrompt.length,
      });
      eventBus.emit('agent:thinking', this.stage, userPrompt.length);

      const response = await this.provider.call(userPrompt, { systemPrompt: builderPrompt });
      this.extractAndWriteArtifacts(response.content, [comp], builtComponents, previewFiles);

      this.logger.agent(this.stage, 'info', 'builder:complete', { component: comp.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.agent(this.stage, 'warn', 'builder:failed', { component: comp.name, error: message });
    }
  }

  /**
   * Build a batch of components in a single LLM call.
   */
  private async buildBatch(
    context: AgentContext,
    plan: UIPlan,
    batch: UIPlanComponent[],
    builtComponents: Map<string, string>,
    previewFiles: string[],
    builderPrompt: string,
  ): Promise<void> {
    const userPrompt = this.buildBatchBuilderUserPrompt(context, plan, batch, builtComponents);
    const componentNames = batch.map(c => c.name);

    this.logger.agent(this.stage, 'info', 'builder:call', {
      components: componentNames,
      batchSize: batch.length,
      promptLength: userPrompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, { systemPrompt: builderPrompt });
    const written = this.extractAndWriteArtifacts(response.content, batch, builtComponents, previewFiles);

    // Check if all components were generated
    const missingComponents = batch.filter(c => !written.has(c.name));
    if (missingComponents.length > 0) {
      this.logger.agent(this.stage, 'warn', 'batch:incomplete', {
        missing: missingComponents.map(c => c.name),
        written: [...written],
      });

      // Retry missing components individually
      for (const comp of missingComponents) {
        await this.buildSingleComponent(context, plan, comp, builtComponents, previewFiles, builderPrompt);
      }
    }

    this.logger.agent(this.stage, 'info', 'builder:complete', { components: componentNames });
  }

  /**
   * Extract ARTIFACT blocks from LLM response, write to disk, and track results.
   * Returns the set of component names that had their tsx written.
   */
  private extractAndWriteArtifacts(
    raw: string,
    expectedComponents: UIPlanComponent[],
    builtComponents: Map<string, string>,
    previewFiles: string[],
  ): Set<string> {
    const written = new Set<string>();
    const artifactPattern = /<!-- ARTIFACT:([\S]+) -->\s*([\s\S]*?)\s*<!-- END:\1 -->/g;
    let match;

    while ((match = artifactPattern.exec(raw)) !== null) {
      const name = match[1];
      const content = match[2].trim()
        .replace(/^```(?:tsx|html|json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '');
      this.writeOutput(name, content);

      for (const comp of expectedComponents) {
        if (name === comp.file) {
          builtComponents.set(comp.name, content);
          written.add(comp.name);
        }
        if (name === comp.preview) {
          previewFiles.push(name);
        }
      }
    }

    // Log missing artifacts
    for (const comp of expectedComponents) {
      if (!written.has(comp.name)) {
        this.logger.agent(this.stage, 'warn', 'builder:missing-tsx', {
          component: comp.name,
          expected: comp.file,
        });
      }
    }

    return written;
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
        covers_features: c.covers_features,
      }));

    const screenshots = components.map(
      (c) => `screenshots/${c.name}.png`
    );
    const previews = previewFiles;

    const manifestData: {
      components: { name: string; file: string; covers_features: string[] }[];
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

  /**
   * Build a user prompt for a batch of components.
   * Uses trimmed API spec and batch-specific output requirements.
   */
  private buildBatchBuilderUserPrompt(
    context: AgentContext,
    plan: UIPlan,
    batch: UIPlanComponent[],
    builtComponents: Map<string, string>,
  ): string {
    const sections: string[] = [];

    // All component specs as JSON array
    sections.push(`## Components to Build (${batch.length} components)\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``);

    // Design tokens
    if (plan.design_tokens) {
      sections.push(`## Design Tokens\n\`\`\`json\n${JSON.stringify(plan.design_tokens, null, 2)}\n\`\`\``);
    }

    // Trimmed API spec based on batch's collective feature coverage
    const apiSpec = context.inputArtifacts.get('api-spec.yaml');
    if (apiSpec) {
      const batchFeatureIds = [...new Set(batch.flatMap(c => c.covers_features))];
      const prd = context.inputArtifacts.get('prd.md') ?? '';
      const trimmed = trimApiSpec(apiSpec, batchFeatureIds, prd);
      sections.push(`## API Specification\n${trimmed}`);
    }

    // Sibling context — only components from OTHER batches that are already built
    const batchNames = new Set(batch.map(c => c.name));
    const externalSiblings = new Map<string, string>();
    for (const [name, tsx] of builtComponents) {
      if (!batchNames.has(name)) externalSiblings.set(name, tsx);
    }

    if (externalSiblings.size > 0) {
      const siblingEntries = Array.from(externalSiblings.entries());
      const siblingSections: string[] = [];

      for (let i = 0; i < siblingEntries.length; i++) {
        const [name, tsx] = siblingEntries[i];
        if (i < FULL_SIBLING_COUNT) {
          siblingSections.push(`### ${name} (full)\n\`\`\`tsx\n${tsx}\n\`\`\``);
        } else {
          const lines = tsx.split('\n');
          const summary = lines.slice(0, SIBLING_SUMMARY_LINES).join('\n');
          siblingSections.push(`### ${name} (summary)\n\`\`\`tsx\n${summary}\n// ... (${lines.length - SIBLING_SUMMARY_LINES} more lines)\n\`\`\``);
        }
      }

      sections.push(`## Already Built Components (for consistency)\n${siblingSections.join('\n\n')}`);
    }

    // Batch output requirements — 2 ARTIFACT blocks per component
    const outputLines = batch.map(comp =>
      `\`<!-- ARTIFACT:${comp.file} -->\`\n...React component code...\n\`<!-- END:${comp.file} -->\`\n\n\`<!-- ARTIFACT:${comp.preview} -->\`\n...Self-contained HTML preview...\n\`<!-- END:${comp.preview} -->\``
    );
    sections.push(`## Output Requirements
Produce exactly 2 ARTIFACT blocks **per component** (${batch.length * 2} total):

${outputLines.join('\n\n')}`);

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
