import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import { STAGE_ORDER } from '../../core/types.js';

// Mock provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const sys = _options?.systemPrompt ?? '';

    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->\n{"components": [{"name": "C1", "file": "components/C1.tsx", "preview": "previews/C1.html", "purpose": "Test", "covers_flow": "main", "parent": null, "children": [], "props": [], "priority": 1}]}\n<!-- END:ui-plan.json -->` };
    }
    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:components/C1.tsx -->\nexport default function C1() { return <div>T</div>; }\n<!-- END:components/C1.tsx -->\n\n<!-- ARTIFACT:previews/C1.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div>T</div></body></html>\n<!-- END:previews/C1.html -->` };
    }

    const stageResponses: Record<string, string> = {
      researcher: `<!-- ARTIFACT:research.md -->\n## Market Overview\nTest\n<!-- END:research.md -->\n<!-- MANIFEST:research.manifest.json -->\n{"competitors": ["A"], "key_insights": ["t"], "feasibility": "high", "risks": []}\n<!-- END:MANIFEST -->`,
      product_owner: `<!-- ARTIFACT:prd.md -->\n## Goal\nTest\n## Features\n- f1\n<!-- END:prd.md -->\n<!-- MANIFEST:prd.manifest.json -->\n{"features": ["f1"], "constraints": [], "out_of_scope": []}\n<!-- END:MANIFEST -->`,
      ux_designer: `<!-- ARTIFACT:ux-flows.md -->\n## User Journeys\n### Flow 1: main\nA → B\n## Component Inventory\n- C1\n<!-- END:ux-flows.md -->\n<!-- MANIFEST:ux-flows.manifest.json -->\n{"flows": ["main"], "components": ["C1"], "interaction_rules": []}\n<!-- END:MANIFEST -->`,
      api_designer: `<!-- ARTIFACT:api-spec.yaml -->\nopenapi: "3.0.0"\ninfo:\n  title: T\npaths:\n  /t:\n    get:\n      summary: T\n<!-- END:api-spec.yaml -->\n<!-- MANIFEST:api-spec.manifest.json -->\n{"endpoints": [{"method": "GET", "path": "/t", "covers_feature": "f1"}], "models": ["M"]}\n<!-- END:MANIFEST -->`,
      validator: `<!-- ARTIFACT:validation-report.md -->\n## Validation Summary\n- Status: PASS\n<!-- END:validation-report.md -->`,
    };

    // Detect stage from prompt content
    for (const [stage, response] of Object.entries(stageResponses)) {
      const artifactName = stage === 'researcher' ? 'research.md' : stage === 'product_owner' ? 'prd.md' : stage === 'ux_designer' ? 'ux-flows.md' : stage === 'api_designer' ? 'api-spec.yaml' : 'validation-report.md';
      if (_prompt.includes(artifactName) || sys.includes(stage.replace('_', ' '))) {
        return { content: response };
      }
    }

    // Fallback
    const nonUIStages = STAGE_ORDER.filter((s) => s !== 'ui_designer');
    const stage = nonUIStages[this.callCount - 1];
    return { content: stageResponses[stage] ?? '[mock] unknown' };
  }
}

vi.mock('../../core/provider-factory.js', () => ({
  createProvider: () => new MockLLMProvider(),
}));

vi.mock('../../core/agent-factory.js', async () => {
  const { ResearcherAgent } = await import('../../agents/researcher.js');
  const { ProductOwnerAgent } = await import('../../agents/product-owner.js');
  const { UXDesignerAgent } = await import('../../agents/ux-designer.js');
  const { APIDesignerAgent } = await import('../../agents/api-designer.js');
  const { UIDesignerAgent } = await import('../../agents/ui-designer.js');
  const { ValidatorAgent } = await import('../../agents/validator.js');

  const AGENT_MAP = {
    researcher: ResearcherAgent,
    product_owner: ProductOwnerAgent,
    ux_designer: UXDesignerAgent,
    api_designer: APIDesignerAgent,
    ui_designer: UIDesignerAgent,
    validator: ValidatorAgent,
  } as const;

  return {
    createAgent: (stage: keyof typeof AGENT_MAP, provider: unknown, logger: unknown) => {
      const AgentClass = AGENT_MAP[stage];
      return new AgentClass(stage, provider as any, logger as any);
    },
  };
});

describe('MCP Tools', () => {
  beforeEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('should register tools on McpServer', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { RunManager } = await import('../../core/run-manager.js');
    const { registerTools } = await import('../tools.js');

    const server = new McpServer({ name: 'test', version: '0.0.1' });
    const runManager = new RunManager();

    // Should not throw
    registerTools(server, runManager);
  });

  it('should start a run via RunManager and track to completion', async () => {
    const { RunManager } = await import('../../core/run-manager.js');
    const runManager = new RunManager();

    // Start run with auto-approve
    const runId = await runManager.startRun('test idea', true);
    expect(runId).toBeDefined();

    // Wait for pipeline to complete
    await runManager.waitForRun(runId);

    const status = runManager.getStatus(runId);
    expect(status).toBeDefined();
    expect(status!.state).toBe('completed');

    // Artifacts should exist
    expect(fs.existsSync('.mosaic/artifacts/research.md')).toBe(true);
    expect(fs.existsSync('.mosaic/artifacts/prd.md')).toBe(true);
    expect(fs.existsSync('.mosaic/artifacts/validation-report.md')).toBe(true);
  }, 30000);

  it('should list artifacts from disk', async () => {
    const { RunManager } = await import('../../core/run-manager.js');
    const runManager = new RunManager();

    const runId = await runManager.startRun('test', true);
    await runManager.waitForRun(runId);

    // Simulate what mosaic_artifacts tool does
    const artifactsDir = '.mosaic/artifacts';
    // Use the same listFilesRecursive approach as the tool
    function listFiles(dir: string, prefix = ''): string[] {
      const result: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) result.push(...listFiles(`${dir}/${entry.name}`, rel));
        else result.push(rel);
      }
      return result;
    }
    const files = listFiles(artifactsDir);

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('research.md');
    expect(files).toContain('prd.md');
  }, 30000);

  it('should return error for unknown run status', async () => {
    const { RunManager } = await import('../../core/run-manager.js');
    const runManager = new RunManager();

    const status = runManager.getStatus('nonexistent');
    expect(status).toBeUndefined();
  });
});
