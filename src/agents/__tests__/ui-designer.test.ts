import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ClarificationNeeded } from '../../core/types.js';
import { createTestMosaicDir, cleanupTestMosaicDir } from '../../__tests__/test-helpers.js';
import { UIDesignerAgent } from '../ui-designer.js';
import { Logger } from '../../core/logger.js';

const ARTIFACTS_DIR = '.mosaic/artifacts';

class MockUIProvider implements LLMProvider {
  callCount = 0;
  calls: Array<{ prompt: string; systemPrompt?: string }> = [];
  private builderCallCount = 0;
  // Set to true to make the second builder call fail
  failOnBuilder = 0;

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    this.calls.push({ prompt, systemPrompt: options?.systemPrompt });
    const sys = options?.systemPrompt ?? '';

    // Planner
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->
{
  "design_tokens": {"primary": "blue-600"},
  "components": [
    {"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "First component", "covers_features": ["F-001"], "parent": null, "children": [], "props": ["text: string"], "priority": 1},
    {"name": "CompB", "file": "components/CompB.tsx", "preview": "previews/CompB.html", "purpose": "Second component", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 2}
  ]
}
<!-- END:ui-plan.json -->` };
    }

    // Builder
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      this.builderCallCount++;

      if (this.failOnBuilder === this.builderCallCount) {
        throw new Error('Simulated builder failure');
      }

      const components: Record<number, { name: string; tsx: string; html: string }> = {
        1: {
          name: 'CompA',
          tsx: 'export default function CompA() { return <div>A</div>; }',
          html: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div>A</div></body></html>',
        },
        2: {
          name: 'CompB',
          tsx: 'export default function CompB() { return <div>B</div>; }',
          html: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div>B</div></body></html>',
        },
      };

      const comp = components[this.builderCallCount] ?? components[1];
      return { content: `<!-- ARTIFACT:components/${comp.name}.tsx -->\n${comp.tsx}\n<!-- END:components/${comp.name}.tsx -->\n\n<!-- ARTIFACT:previews/${comp.name}.html -->\n${comp.html}\n<!-- END:previews/${comp.name}.html -->` };
    }

    return { content: '[unknown call]' };
  }
}

// Mock screenshot renderer to avoid Playwright dependency in unit tests
vi.mock('../../core/screenshot-renderer.js', () => ({
  renderPreviewScreenshots: async () => [],
  generateGallery: () => '.mosaic/artifacts/gallery.html',
}));

function makeContext(): AgentContext {
  return {
    systemPrompt: '# UIDesigner Agent\nYou are a UI designer.',
    task: { runId: 'test-run', stage: 'ui_designer', instruction: 'Build a todo app' },
    inputArtifacts: new Map([
      ['prd.md', '## Goal\nTodo app\n## Features\n- task-crud'],
      ['ux-flows.md', '## Component Inventory\n- CompA\n- CompB'],
      ['api-spec.yaml', 'openapi: "3.0.0"\ninfo:\n  title: Test'],
    ]),
  };
}

describe('UIDesignerAgent', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = createTestMosaicDir();
  });

  afterEach(() => {
    cleanupTestMosaicDir(tmpRoot);
  });

  it('should make 1 planner call + N builder calls', async () => {
    const provider = new MockUIProvider();
    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    // 1 planner + 2 builder = 3 total calls
    expect(provider.callCount).toBe(3);

    // First call should be planner (system prompt contains planner content)
    expect(provider.calls[0].systemPrompt).toContain('planning phase of the UI designer');

    // Second and third calls should be builder
    expect(provider.calls[1].systemPrompt).toContain('builder phase of the UI designer');
    expect(provider.calls[2].systemPrompt).toContain('builder phase of the UI designer');
  });

  it('should write ui-plan.json, component files, and previews', async () => {
    const provider = new MockUIProvider();
    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    expect(fs.existsSync(`${ARTIFACTS_DIR}/ui-plan.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/CompA.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/CompB.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/CompA.html`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/CompB.html`)).toBe(true);
  });

  it('should programmatically generate manifest', async () => {
    const provider = new MockUIProvider();
    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    expect(fs.existsSync(`${ARTIFACTS_DIR}/components.manifest.json`)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/components.manifest.json`, 'utf-8'));

    expect(manifest.components).toHaveLength(2);
    expect(manifest.components[0].name).toBe('CompA');
    expect(manifest.components[0].file).toBe('components/CompA.tsx');
    expect(manifest.components[0].covers_features).toEqual(['F-001']);
    expect(manifest.previews).toHaveLength(2);
  });

  it('should continue when a single component build fails', async () => {
    const provider = new MockUIProvider();
    provider.failOnBuilder = 1; // Fail on first builder call (CompA)
    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    // CompA should NOT exist (failed)
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/CompA.tsx`)).toBe(false);

    // CompB should exist (succeeded)
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/CompB.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/CompB.html`)).toBe(true);

    // Manifest should only contain CompB
    const manifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/components.manifest.json`, 'utf-8'));
    expect(manifest.components).toHaveLength(1);
    expect(manifest.components[0].name).toBe('CompB');
  });

  it('should pass sibling context to later builder calls', async () => {
    const provider = new MockUIProvider();
    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    // Second builder call (CompB) should include CompA in its prompt
    const secondBuilderPrompt = provider.calls[2].prompt;
    expect(secondBuilderPrompt).toContain('Already Built Components');
    expect(secondBuilderPrompt).toContain('CompA');
  });

  it('should throw ClarificationNeeded when planner requests clarification', async () => {
    const provider: LLMProvider = {
      async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
        return { content: `<!-- CLARIFICATION -->
{
  "question": "Pick a style:",
  "options": [
    { "label": "Minimal" },
    { "label": "Material" }
  ],
  "allow_custom": true
}
<!-- END:CLARIFICATION -->` };
      },
    };

    const logger = new Logger('test');
    const agent = new UIDesignerAgent('ui_designer', provider, logger);

    await expect(agent.execute(makeContext())).rejects.toThrow(ClarificationNeeded);
    await logger.close();
  });
});
