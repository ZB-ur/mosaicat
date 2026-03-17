import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../llm-provider.js';
import { STAGE_ORDER } from '../types.js';

// Mock provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const sys = _options?.systemPrompt ?? '';

    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->\n{"components": [{"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "Test", "covers_flow": "main-flow", "parent": null, "children": [], "props": [], "priority": 1}]}\n<!-- END:ui-plan.json -->` };
    }
    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:components/CompA.tsx -->\nexport default function CompA() {\n  return <div className="p-4">Test</div>;\n}\n<!-- END:components/CompA.tsx -->\n\n<!-- ARTIFACT:previews/CompA.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Test</div></body></html>\n<!-- END:previews/CompA.html -->` };
    }

    const stage = STAGE_ORDER[this.callCount - 1];

    const responses: Record<string, string> = {
      researcher: `<!-- ARTIFACT:research.md -->\n## Market Overview\nTest research content\n<!-- END:research.md -->\n<!-- MANIFEST:research.manifest.json -->\n{"competitors": ["A"], "key_insights": ["test"], "feasibility": "high", "risks": []}\n<!-- END:MANIFEST -->`,
      product_owner: `<!-- ARTIFACT:prd.md -->\n## Goal\nTest goal\n## Features\n- feat-a\n<!-- END:prd.md -->\n<!-- MANIFEST:prd.manifest.json -->\n{"features": ["feat-a"], "constraints": [], "out_of_scope": []}\n<!-- END:MANIFEST -->`,
      ux_designer: `<!-- ARTIFACT:ux-flows.md -->\n## User Journeys\n### Flow 1: main-flow\nStep 1 → Step 2\n## Component Inventory\n- CompA\n<!-- END:ux-flows.md -->\n<!-- MANIFEST:ux-flows.manifest.json -->\n{"flows": ["main-flow"], "components": ["CompA"], "interaction_rules": []}\n<!-- END:MANIFEST -->`,
      api_designer: `<!-- ARTIFACT:api-spec.yaml -->\nopenapi: "3.0.0"\ninfo:\n  title: Test\npaths:\n  /test:\n    get:\n      summary: Test\n<!-- END:api-spec.yaml -->\n<!-- MANIFEST:api-spec.manifest.json -->\n{"endpoints": [{"method": "GET", "path": "/test", "covers_feature": "feat-a"}], "models": ["TestModel"]}\n<!-- END:MANIFEST -->`,
      validator: `<!-- ARTIFACT:validation-report.md -->\n## Validation Summary\n- Status: PASS\n- Checks passed: 4/4\n<!-- END:validation-report.md -->`,
    };

    return { content: responses[stage!] ?? '[mock] unknown stage' };
  }
}

// Mock the provider factory to use our mock
vi.mock('../provider-factory.js', () => ({
  createProvider: () => new MockLLMProvider(),
}));

// Mock the agent factory to use real agents
vi.mock('../agent-factory.js', async () => {
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

describe('RunManager', () => {
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

  it('should start a run and track status through completion (auto-approve)', async () => {
    // Dynamic import to ensure mocks are applied
    const { RunManager } = await import('../run-manager.js');
    const manager = new RunManager();

    const runId = await manager.startRun('test instruction', true);
    expect(runId).toMatch(/^managed-/);

    // Status should be available immediately
    const status = manager.getStatus(runId);
    expect(status).toBeDefined();
    expect(status!.instruction).toBe('test instruction');

    // Wait for completion
    const result = await manager.waitForRun(runId);
    expect(result.completedAt).toBeDefined();

    // Final status should be completed
    const finalStatus = manager.getStatus(runId);
    expect(finalStatus!.state).toBe('completed');
  }, 30000);

  it('should list all runs', async () => {
    const { RunManager } = await import('../run-manager.js');
    const manager = new RunManager();

    const id1 = await manager.startRun('test 1', true);
    await manager.waitForRun(id1);

    const runs = manager.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.some((r) => r.id === id1)).toBe(true);
  }, 30000);

  it('should throw for unknown run id', async () => {
    const { RunManager } = await import('../run-manager.js');
    const manager = new RunManager();

    expect(() => manager.approve('nonexistent')).toThrow('not found');
    expect(() => manager.reject('nonexistent')).toThrow('not found');
    expect(() => manager.answerClarification('nonexistent', 'answer')).toThrow('not found');
  });

  it('should return undefined for unknown run status', async () => {
    const { RunManager } = await import('../run-manager.js');
    const manager = new RunManager();

    expect(manager.getStatus('nonexistent')).toBeUndefined();
  });
});
