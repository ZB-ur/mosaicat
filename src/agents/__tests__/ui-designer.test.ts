import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ClarificationNeeded } from '../../core/types.js';
import { createTestRunContext, createTestArtifactStore } from '../../__tests__/test-helpers.js';
import { UIDesignerAgent } from '../ui-designer.js';
import type { RunContext } from '../../core/run-context.js';

class MockUIProvider implements LLMProvider {
  callCount = 0;
  calls: Array<{ prompt: string; systemPrompt?: string }> = [];
  private builderCallCount = 0;
  // Set to make a specific builder call fail
  failOnBuilder = 0;

  private componentData: Record<string, { tsx: string; html: string }> = {
    CompA: {
      tsx: 'export default function CompA() { return <div>A</div>; }',
      html: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div>A</div></body></html>',
    },
    CompB: {
      tsx: 'export default function CompB() { return <div>B</div>; }',
      html: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div>B</div></body></html>',
    },
  };

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
    {"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "First component", "covers_features": ["F-001"], "parent": null, "children": [], "props": ["text: string"], "priority": 1, "category": "atomic"},
    {"name": "CompB", "file": "components/CompB.tsx", "preview": "previews/CompB.html", "purpose": "Second component", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 2, "category": "atomic"}
  ]
}
<!-- END:ui-plan.json -->` };
    }

    // Builder — detect which component(s) are being requested from the prompt
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      this.builderCallCount++;

      if (this.failOnBuilder === this.builderCallCount) {
        throw new Error('Simulated builder failure');
      }

      // Detect requested components from prompt content
      const requestedNames = Object.keys(this.componentData).filter(
        name => prompt.includes(`"name": "${name}"`)
      );

      // Generate ARTIFACT blocks for all requested components
      const blocks: string[] = [];
      for (const name of requestedNames) {
        const comp = this.componentData[name];
        if (comp) {
          blocks.push(
            `<!-- ARTIFACT:components/${name}.tsx -->\n${comp.tsx}\n<!-- END:components/${name}.tsx -->\n\n` +
            `<!-- ARTIFACT:previews/${name}.html -->\n${comp.html}\n<!-- END:previews/${name}.html -->`
          );
        }
      }

      return { content: blocks.join('\n\n') };
    }

    return { content: '[unknown call]' };
  }
}

// Mock screenshot renderer to avoid Playwright dependency in unit tests
vi.mock('../../core/screenshot-renderer.js', () => ({
  renderPreviewScreenshots: async () => [],
  generateGallery: () => 'gallery.html',
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

/** Create a RunContext and return it with the artifacts directory path */
function createCtx(provider: LLMProvider): { ctx: RunContext; artifactsDir: string } {
  const store = createTestArtifactStore();
  const ctx = createTestRunContext({ provider, store });
  return { ctx, artifactsDir: store.getDir() };
}

describe('UIDesignerAgent', () => {
  it('should make planner + builder calls (batched for atomic)', async () => {
    const provider = new MockUIProvider();
    const { ctx } = createCtx(provider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    await agent.execute(makeContext());

    // Both atomic components are batched together:
    // 1 planner + 1 batch builder = 2 total calls
    expect(provider.callCount).toBe(2);

    // First call should be planner
    expect(provider.calls[0].systemPrompt).toContain('planning phase of the UI designer');

    // Second call should be builder (batch of 2 atomic components)
    expect(provider.calls[1].systemPrompt).toContain('builder phase of the UI designer');
  });

  it('should write ui-plan.json, component files, and previews', async () => {
    const provider = new MockUIProvider();
    const { ctx, artifactsDir } = createCtx(provider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    await agent.execute(makeContext());

    expect(fs.existsSync(path.join(artifactsDir, 'ui-plan.json'))).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'components/CompA.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'components/CompB.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'previews/CompA.html'))).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'previews/CompB.html'))).toBe(true);
  });

  it('should programmatically generate manifest', async () => {
    const provider = new MockUIProvider();
    const { ctx, artifactsDir } = createCtx(provider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    await agent.execute(makeContext());

    const manifestPath = path.join(artifactsDir, 'components.manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.components).toHaveLength(2);
    expect(manifest.components[0].name).toBe('CompA');
    expect(manifest.components[0].file).toBe('components/CompA.tsx');
    expect(manifest.components[0].covers_features).toEqual(['F-001']);
    expect(manifest.previews).toHaveLength(2);
  });

  it('should retry failed component and recover via retry pass', async () => {
    const provider = new MockUIProvider();
    provider.failOnBuilder = 1; // Fail on first builder call (the batch)
    const { ctx, artifactsDir } = createCtx(provider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    await agent.execute(makeContext());

    // Both components should exist — batch failed, fallback to individual succeeded,
    // and retry pass picks up any remaining
    expect(fs.existsSync(path.join(artifactsDir, 'components/CompA.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(artifactsDir, 'components/CompB.tsx'))).toBe(true);

    // Manifest should contain both components
    const manifestPath = path.join(artifactsDir, 'components.manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.components).toHaveLength(2);
  });

  it('should throw when too many components fail to build', async () => {
    // Provider that returns responses with no ARTIFACT blocks for builders
    const silentFailProvider: LLMProvider = {
      async call(_prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
        const sys = options?.systemPrompt ?? '';
        if (sys.includes('planning phase of the UI designer')) {
          return { content: `<!-- ARTIFACT:ui-plan.json -->
{
  "design_tokens": {"primary": "blue-600"},
  "components": [
    {"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "First", "covers_features": ["F-001"], "parent": null, "children": [], "props": ["text: string"], "priority": 1, "category": "atomic"},
    {"name": "CompB", "file": "components/CompB.tsx", "preview": "previews/CompB.html", "purpose": "Second", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 2, "category": "atomic"},
    {"name": "CompC", "file": "components/CompC.tsx", "preview": "previews/CompC.html", "purpose": "Third", "covers_features": ["F-003"], "parent": null, "children": [], "props": [], "priority": 3, "category": "atomic"}
  ]
}
<!-- END:ui-plan.json -->` };
        }
        // Builder: return text without ARTIFACT blocks (simulating silent failure)
        return { content: 'I apologize, I cannot generate this component due to complexity limitations.' };
      },
    };

    const { ctx } = createCtx(silentFailProvider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    // Should throw because 100% of components are missing (> 20% threshold)
    await expect(agent.execute(makeContext())).rejects.toThrow(/built only 0\/3/);
  });

  it('should include missing_components in manifest when under threshold', async () => {
    // Provider where one component silently fails but the rest succeed (under 20% threshold)
    let builderCallCount = 0;
    const partialFailProvider: LLMProvider = {
      async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
        const sys = options?.systemPrompt ?? '';
        if (sys.includes('planning phase of the UI designer')) {
          return { content: `<!-- ARTIFACT:ui-plan.json -->
{
  "design_tokens": {"primary": "blue-600"},
  "components": [
    {"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "First", "covers_features": ["F-001"], "parent": null, "children": [], "props": [], "priority": 1, "category": "page"},
    {"name": "CompB", "file": "components/CompB.tsx", "preview": "previews/CompB.html", "purpose": "Second", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 2, "category": "page"},
    {"name": "CompC", "file": "components/CompC.tsx", "preview": "previews/CompC.html", "purpose": "Third", "covers_features": ["F-003"], "parent": null, "children": [], "props": [], "priority": 3, "category": "page"},
    {"name": "CompD", "file": "components/CompD.tsx", "preview": "previews/CompD.html", "purpose": "Fourth", "covers_features": ["F-004"], "parent": null, "children": [], "props": [], "priority": 4, "category": "page"},
    {"name": "CompE", "file": "components/CompE.tsx", "preview": "previews/CompE.html", "purpose": "Fifth", "covers_features": ["F-005"], "parent": null, "children": [], "props": [], "priority": 5, "category": "page"}
  ]
}
<!-- END:ui-plan.json -->` };
        }
        // Builder
        builderCallCount++;
        // Detect which component is being requested
        const names = ['CompA', 'CompB', 'CompC', 'CompD', 'CompE'];
        for (const name of names) {
          if (prompt.includes(`"name": "${name}"`)) {
            // CompE always fails silently (returns no ARTIFACT blocks)
            if (name === 'CompE') {
              return { content: 'I cannot generate this component.' };
            }
            return { content: `<!-- ARTIFACT:components/${name}.tsx -->\nexport default function ${name}() { return <div>${name}</div>; }\n<!-- END:components/${name}.tsx -->\n\n<!-- ARTIFACT:previews/${name}.html -->\n<html><body>${name}</body></html>\n<!-- END:previews/${name}.html -->` };
          }
        }
        return { content: 'unknown' };
      },
    };

    const { ctx, artifactsDir } = createCtx(partialFailProvider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    // 1/5 = 20% missing, which is exactly at threshold (not >20%), should succeed
    await agent.execute(makeContext());

    const manifestPath = path.join(artifactsDir, 'components.manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.components).toHaveLength(4);
    expect(manifest.missing_components).toEqual(['CompE']);
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

    const { ctx } = createCtx(provider);
    const agent = new UIDesignerAgent('ui_designer', ctx);

    await expect(agent.execute(makeContext())).rejects.toThrow(ClarificationNeeded);
  });
});
