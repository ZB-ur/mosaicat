import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { artifactExists } from '../core/artifact.js';
import { readManifest, type ComponentsManifest } from '../core/manifest.js';

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
      usage: response.usage,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    if (response.usage) {
      eventBus.emit('agent:usage', this.stage, response.usage);
    }

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

    // Strip any LLM-generated Check 5 (we generate it programmatically)
    content = content.replace(/\n*### Check 5: File Integrity[\s\S]*$/, '').trimEnd();

    // Post-LLM: programmatic file integrity check (Check 5)
    const integrity = this.checkFileIntegrity();
    content = this.appendIntegrityCheck(content, integrity);

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
