import type { AgentContext } from '../core/types.js';
import { ClarificationNeeded } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import { assemblePrompt, type OutputSpec } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';

export class UIDesignerAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['components/', 'previews/', 'gallery.html'],
      manifest: 'components.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: prompt.length,
    });
    eventBus.emit('agent:thinking', this.stage, prompt.length);

    const raw = await this.provider.call(prompt, {
      systemPrompt: context.systemPrompt,
    });

    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Check for clarification
    const clarificationMatch = raw.match(
      /<!-- CLARIFICATION -->\s*([\s\S]*?)\s*<!-- END:CLARIFICATION -->/
    );
    if (clarificationMatch) {
      throw new ClarificationNeeded(clarificationMatch[1].trim());
    }

    // Dynamically extract all ARTIFACT blocks (component files have dynamic names)
    const artifactPattern = /<!-- ARTIFACT:([\S]+) -->\s*([\s\S]*?)\s*<!-- END:\1 -->/g;
    const previewFiles: string[] = [];
    let match;
    while ((match = artifactPattern.exec(raw)) !== null) {
      const name = match[1];
      const content = match[2].trim();
      this.writeOutput(name, content);
      if (name.startsWith('previews/') && name.endsWith('.html')) {
        previewFiles.push(name);
      }
    }

    // Extract manifest
    const manifestPattern = /<!-- MANIFEST:components\.manifest\.json -->\s*([\s\S]*?)\s*<!-- END:MANIFEST -->/;
    const manifestMatch = raw.match(manifestPattern);
    if (manifestMatch) {
      const jsonStr = manifestMatch[1].trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      try {
        const data = JSON.parse(jsonStr);
        this.writeOutputManifest('components.manifest.json', data);
      } catch {
        throw new Error('Failed to parse components.manifest.json from LLM response');
      }
    }

    // Post-processing: render preview screenshots + gallery (graceful degradation)
    if (previewFiles.length > 0) {
      await this.renderPreviewsAndGallery(previewFiles);
    }
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
