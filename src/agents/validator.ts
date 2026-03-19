import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { artifactExists } from '../core/artifact.js';
import {
  readManifest,
  type PrdManifest,
  type UxFlowsManifest,
  type ApiSpecManifest,
  type ComponentsManifest,
} from '../core/manifest.js';

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
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    const response = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });
    const raw = response.content;

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

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

    // Strip any LLM-generated Check 5/6 (we generate them programmatically)
    content = content.replace(/\n*### Check 5: File Integrity[\s\S]*$/, '').trimEnd();
    content = content.replace(/\n*### Check 6: Feature ID Traceability[\s\S]*$/, '').trimEnd();

    // Post-LLM: programmatic file integrity check (Check 5)
    const integrity = this.checkFileIntegrity();
    content = this.appendIntegrityCheck(content, integrity);

    // Post-LLM: programmatic Feature ID traceability check (Check 6)
    const traceability = this.checkFeatureIdTraceability();
    content = this.appendTraceabilityCheck(content, traceability);

    this.writeOutput('validation-report.md', content);
  }

  private checkFileIntegrity(): { passed: boolean; missing: string[] } {
    const missing: string[] = [];

    try {
      const manifest = readManifest<ComponentsManifest>('components.manifest.json');

      // Check component files
      for (const comp of manifest.components) {
        if (!artifactExists(comp.file)) {
          missing.push(comp.file);
        }
      }

      // Check screenshots
      for (const screenshot of manifest.screenshots) {
        if (!artifactExists(screenshot)) {
          missing.push(screenshot);
        }
      }

      // Check previews (optional field)
      if (manifest.previews) {
        for (const preview of manifest.previews) {
          if (!artifactExists(preview)) {
            missing.push(preview);
          }
        }
      }
    } catch (err) {
      // If manifest doesn't exist or is invalid, report as missing
      missing.push('components.manifest.json (unreadable)');
    }

    return { passed: missing.length === 0, missing };
  }

  private checkFeatureIdTraceability(): { passed: boolean; details: string[] } {
    const details: string[] = [];
    let allFeatureIds: string[] = [];

    try {
      const prd = readManifest<PrdManifest>('prd.manifest.json');
      allFeatureIds = prd.features.map((f) => f.id);
      details.push(`PRD defines ${allFeatureIds.length} features: ${allFeatureIds.join(', ')}`);
    } catch {
      details.push('prd.manifest.json unreadable — cannot trace features');
      return { passed: false, details };
    }

    if (allFeatureIds.length === 0) {
      details.push('No features defined in PRD — skipping traceability');
      return { passed: true, details };
    }

    // Check UX flows coverage
    const uxCovered = new Set<string>();
    try {
      const ux = readManifest<UxFlowsManifest>('ux-flows.manifest.json');
      for (const flow of ux.flows) {
        for (const fid of flow.covers_features) uxCovered.add(fid);
      }
      const uxMissing = allFeatureIds.filter((id) => !uxCovered.has(id));
      if (uxMissing.length > 0) {
        details.push(`UX flows missing coverage for: ${uxMissing.join(', ')}`);
      } else {
        details.push(`UX flows cover all ${allFeatureIds.length} features`);
      }
    } catch {
      details.push('ux-flows.manifest.json unreadable — UX traceability skipped');
    }

    // Check API endpoints coverage
    const apiCovered = new Set<string>();
    try {
      const api = readManifest<ApiSpecManifest>('api-spec.manifest.json');
      for (const ep of api.endpoints) {
        for (const fid of ep.covers_features) apiCovered.add(fid);
      }
      const apiMissing = allFeatureIds.filter((id) => !apiCovered.has(id));
      if (apiMissing.length > 0) {
        details.push(`API endpoints missing coverage for: ${apiMissing.join(', ')}`);
      } else {
        details.push(`API endpoints cover all ${allFeatureIds.length} features`);
      }
    } catch {
      details.push('api-spec.manifest.json unreadable — API traceability skipped');
    }

    // Check components coverage
    const compCovered = new Set<string>();
    try {
      const comps = readManifest<ComponentsManifest>('components.manifest.json');
      for (const c of comps.components) {
        for (const fid of c.covers_features) compCovered.add(fid);
      }
      const compMissing = allFeatureIds.filter((id) => !compCovered.has(id));
      if (compMissing.length > 0) {
        details.push(`Components missing coverage for: ${compMissing.join(', ')}`);
      } else {
        details.push(`Components cover all ${allFeatureIds.length} features`);
      }
    } catch {
      details.push('components.manifest.json unreadable — component traceability skipped');
    }

    // Determine pass/fail: all layers must cover all features (if readable)
    const hasMissing = details.some((d) => d.includes('missing coverage for'));
    return { passed: !hasMissing, details };
  }

  private appendTraceabilityCheck(
    content: string,
    traceability: { passed: boolean; details: string[] },
  ): string {
    const status = traceability.passed ? 'PASS' : 'FAIL';
    const detailLines = traceability.details.map((d) => `- ${d}`).join('\n');
    const check6 = `\n\n### Check 6: Feature ID Traceability\n- Status: ${status}\n${detailLines}`;

    let result = content + check6;

    if (!traceability.passed) {
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

  private appendIntegrityCheck(
    content: string,
    integrity: { passed: boolean; missing: string[] },
  ): string {
    const status = integrity.passed ? 'PASS' : 'FAIL';
    const details = integrity.passed
      ? '- All referenced files exist on disk'
      : `- Missing files:\n${integrity.missing.map((f) => `  - \`${f}\``).join('\n')}`;

    const check5 = `\n\n### Check 5: File Integrity\n- Status: ${status}\n${details}`;

    // Append Check 5 to the report
    let result = content + check5;

    // If Check 5 failed, override overall status to FAIL
    if (!integrity.passed) {
      // Update "Checks passed: N/M" to include Check 5
      result = result.replace(
        /- Checks passed: (\d+)\/(\d+)/,
        (_, passed, total) => {
          const newTotal = parseInt(total) + 1;
          return `- Checks passed: ${passed}/${newTotal}`;
        }
      );
      // Force status to FAIL
      result = result.replace(
        /- Status: PASS\n- Checks passed:/,
        '- Status: FAIL\n- Checks passed:'
      );
    } else {
      // Update counts to include Check 5 as passing
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
