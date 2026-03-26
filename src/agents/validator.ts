import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import {
  readManifest,
  type PrdManifest,
  type UxFlowsManifest,
  type ApiSpecManifest,
  type ComponentsManifest,
  type TechSpecManifest,
  type CodeManifest,
} from '../core/manifest.js';

interface CheckResult {
  name: string;
  passed: boolean;
  details: string | string[];
}

export class ValidatorAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['validation-report.md'],
      // Validator has no manifest output
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
    });
    this.ctx.eventBus.emit('agent:thinking', this.stage, prompt.length);

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });
    const raw = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    this.ctx.eventBus.emit('agent:response', this.stage, raw.length);

    // Check for clarification (shouldn't happen for validator, but handle defensively)
    const clarificationMatch = raw.match(
      /<!-- CLARIFICATION -->\s*([\s\S]*?)\s*<!-- END:CLARIFICATION -->/
    );
    if (clarificationMatch) {
      throw new ClarificationNeeded(clarificationMatch[1].trim());
    }

    // Extract artifact by delimiter or use full response as fallback
    const artifactPattern = /<!-- ARTIFACT:validation-report\.md -->\s*([\s\S]*?)\s*<!-- END:validation-report\.md -->/;
    const artifactMatch = raw.match(artifactPattern);
    let content = artifactMatch ? artifactMatch[1].trim() : raw.trim();

    // Strip any LLM-generated programmatic checks (we generate them)
    content = content.replace(/\n*### Check 5: File Integrity[\s\S]*$/, '').trimEnd();
    content = content.replace(/\n*### Check 6: Feature ID Traceability[\s\S]*$/, '').trimEnd();
    content = content.replace(/\n*### Check 7: Tech-Spec Feature Coverage[\s\S]*$/, '').trimEnd();
    content = content.replace(/\n*### Check 8: Code Task Coverage[\s\S]*$/, '').trimEnd();

    // Post-LLM: programmatic file integrity check (Check 5)
    const integrity = this.checkFileIntegrity();
    content = this.appendCheck(content, integrity);

    // Post-LLM: programmatic Feature ID traceability check (Check 6)
    const traceability = this.checkFeatureIdTraceability();
    content = this.appendCheck(content, traceability);

    // Post-LLM: programmatic tech-spec feature coverage (Check 7)
    const techSpecCoverage = this.checkTechSpecFeatureCoverage();
    content = this.appendCheck(content, techSpecCoverage);

    // Post-LLM: programmatic code task coverage (Check 8)
    const codeTaskCoverage = this.checkCodeTaskCoverage();
    content = this.appendCheck(content, codeTaskCoverage);

    this.writeOutput('validation-report.md', content);
  }

  private checkFileIntegrity(): CheckResult {
    const missing: string[] = [];

    try {
      const manifest = readManifest<ComponentsManifest>(this.ctx.store, 'components.manifest.json');

      for (const comp of manifest.components) {
        if (!this.ctx.store.exists(comp.file)) missing.push(comp.file);
      }
      for (const screenshot of manifest.screenshots) {
        if (!this.ctx.store.exists(screenshot)) missing.push(screenshot);
      }
      if (manifest.previews) {
        for (const preview of manifest.previews) {
          if (!this.ctx.store.exists(preview)) missing.push(preview);
        }
      }
    } catch {
      missing.push('components.manifest.json (unreadable)');
    }

    const passed = missing.length === 0;
    const details = passed
      ? 'All referenced files exist on disk'
      : `Missing files:\n${missing.map((f) => `  - \`${f}\``).join('\n')}`;
    return { name: 'Check 5: File Integrity', passed, details };
  }

  private checkFeatureIdTraceability(): CheckResult {
    const details: string[] = [];
    let allFeatureIds: string[] = [];

    try {
      const prd = readManifest<PrdManifest>(this.ctx.store, 'prd.manifest.json');
      allFeatureIds = prd.features.map((f) => f.id);
      details.push(`PRD defines ${allFeatureIds.length} features: ${allFeatureIds.join(', ')}`);
    } catch {
      return { name: 'Check 6: Feature ID Traceability', passed: false, details: ['prd.manifest.json unreadable — cannot trace features'] };
    }

    if (allFeatureIds.length === 0) {
      return { name: 'Check 6: Feature ID Traceability', passed: true, details: ['No features defined in PRD — skipping traceability'] };
    }

    const checkLayer = (manifestName: string, label: string, extractIds: (data: unknown) => Set<string>) => {
      try {
        const data = readManifest(this.ctx.store, manifestName);
        const covered = extractIds(data);
        const missing = allFeatureIds.filter((id) => !covered.has(id));
        if (missing.length > 0) {
          details.push(`${label} missing coverage for: ${missing.join(', ')}`);
        } else {
          details.push(`${label} cover all ${allFeatureIds.length} features`);
        }
      } catch {
        details.push(`${manifestName} unreadable — ${label} traceability skipped`);
      }
    };

    checkLayer('ux-flows.manifest.json', 'UX flows', (data) => {
      const ids = new Set<string>();
      for (const flow of (data as UxFlowsManifest).flows) for (const fid of flow.covers_features) ids.add(fid);
      return ids;
    });

    checkLayer('api-spec.manifest.json', 'API endpoints', (data) => {
      const ids = new Set<string>();
      for (const ep of (data as ApiSpecManifest).endpoints) for (const fid of ep.covers_features) ids.add(fid);
      return ids;
    });

    checkLayer('components.manifest.json', 'Components', (data) => {
      const ids = new Set<string>();
      for (const c of (data as ComponentsManifest).components) for (const fid of c.covers_features) ids.add(fid);
      return ids;
    });

    const hasMissing = details.some((d) => d.includes('missing coverage for'));
    return { name: 'Check 6: Feature ID Traceability', passed: !hasMissing, details };
  }

  private checkTechSpecFeatureCoverage(): CheckResult {
    let allFeatureIds: string[] = [];
    try {
      const prd = readManifest<PrdManifest>(this.ctx.store, 'prd.manifest.json');
      allFeatureIds = prd.features.map((f) => f.id);
    } catch {
      return { name: 'Check 7: Tech-Spec Feature Coverage', passed: true, details: 'prd.manifest.json unreadable — skipped (warning)' };
    }

    try {
      const techSpec = readManifest<TechSpecManifest>(this.ctx.store, 'tech-spec.manifest.json');
      const covered = new Set<string>();
      for (const mod of techSpec.modules) {
        for (const fid of mod.covers_features) covered.add(fid);
      }
      const missing = allFeatureIds.filter((id) => !covered.has(id));
      if (missing.length > 0) {
        return { name: 'Check 7: Tech-Spec Feature Coverage', passed: false, details: `Tech-spec modules missing coverage for: ${missing.join(', ')}` };
      }
      return { name: 'Check 7: Tech-Spec Feature Coverage', passed: true, details: `Tech-spec modules cover all ${allFeatureIds.length} features` };
    } catch {
      return { name: 'Check 7: Tech-Spec Feature Coverage', passed: true, details: 'tech-spec.manifest.json unreadable — skipped (warning, stage may be skipped)' };
    }
  }

  private checkCodeTaskCoverage(): CheckResult {
    let allTaskIds: string[] = [];
    try {
      const techSpec = readManifest<TechSpecManifest>(this.ctx.store, 'tech-spec.manifest.json');
      allTaskIds = techSpec.implementation_tasks.map((t) => t.id);
    } catch {
      return { name: 'Check 8: Code Task Coverage', passed: true, details: 'tech-spec.manifest.json unreadable — skipped (warning, stage may be skipped)' };
    }

    try {
      const code = readManifest<CodeManifest>(this.ctx.store, 'code.manifest.json');
      const coveredTasks = new Set(code.covers_tasks);
      const missing = allTaskIds.filter((id) => !coveredTasks.has(id));
      if (missing.length > 0) {
        return { name: 'Check 8: Code Task Coverage', passed: false, details: `Code missing coverage for tasks: ${missing.join(', ')}` };
      }
      return { name: 'Check 8: Code Task Coverage', passed: true, details: `Code covers all ${allTaskIds.length} tasks` };
    } catch {
      return { name: 'Check 8: Code Task Coverage', passed: true, details: 'code.manifest.json unreadable — skipped (warning, stage may be skipped)' };
    }
  }

  /** Unified method to append a programmatic check to the report */
  private appendCheck(content: string, check: CheckResult): string {
    const status = check.passed ? 'PASS' : 'FAIL';
    const details = typeof check.details === 'string'
      ? `- ${check.details}`
      : check.details.map((d) => `- ${d}`).join('\n');

    const section = `\n\n### ${check.name}\n- Status: ${status}\n${details}`;
    let result = content + section;

    if (!check.passed) {
      result = result.replace(
        /- Checks passed: (\d+)\/(\d+)/,
        (_, passed, total) => {
          const newTotal = parseInt(total) + 1;
          return `- Checks passed: ${passed}/${newTotal}`;
        }
      );
      result = result.replace(
        /- Status: PASS\n- Checks passed:/,
        '- Status: FAIL\n- Checks passed:'
      );
    } else {
      result = result.replace(
        /- Checks passed: (\d+)\/(\d+)/,
        (_, passed, total) => {
          const newPassed = parseInt(passed) + 1;
          const newTotal = parseInt(total) + 1;
          return `- Checks passed: ${newPassed}/${newTotal}`;
        }
      );
    }

    return result;
  }
}
