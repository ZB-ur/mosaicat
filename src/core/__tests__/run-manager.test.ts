import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../llm-provider.js';
import { STAGE_ORDER } from '../types.js';

// Mock provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    const sys = _options?.systemPrompt ?? '';

    // Intent Consultant (don't count as stage call)
    if (sys.includes('Intent Consultant') || _prompt.includes('## User Instruction')) {
      return { content: JSON.stringify({ ready_to_converge: true, intent_brief: { problem: "Test", target_users: "Test", core_scenarios: [], mvp_boundary: "Test", constraints: [], domain_specifics: [], recommended_profile: "design-only", profile_reason: "Test" } }) };
    }
    this.callCount++;
    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->\n{"components": [{"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "Test", "covers_features": ["F-001"], "parent": null, "children": [], "props": [], "priority": 1}]}\n<!-- END:ui-plan.json -->` };
    }
    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:components/CompA.tsx -->\nexport default function CompA() {\n  return <div className="p-4">Test</div>;\n}\n<!-- END:components/CompA.tsx -->\n\n<!-- ARTIFACT:previews/CompA.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Test</div></body></html>\n<!-- END:previews/CompA.html -->` };
    }

    const stage = STAGE_ORDER[this.callCount - 1];

    const responses: Record<string, string> = {
      researcher: JSON.stringify({ artifact: "## Market Overview\nTest research content", manifest: { competitors: ["A"], key_insights: ["test"], feasibility: "high", risks: [] } }),
      product_owner: JSON.stringify({ artifact: "## Goal\nTest goal\n## Features\n- feat-a", manifest: { features: [{ id: "F-001", name: "feat-a" }], constraints: [], out_of_scope: [] } }),
      ux_designer: JSON.stringify({ artifact: "## User Journeys\n### Flow 1: main-flow\nStep 1 → Step 2\n## Component Inventory\n- CompA", manifest: { flows: [{ name: "main-flow", covers_features: ["F-001"] }], components: ["CompA"], interaction_rules: [] } }),
      api_designer: JSON.stringify({ artifact: "openapi: \"3.0.0\"\ninfo:\n  title: Test\npaths:\n  /test:\n    get:\n      summary: Test", manifest: { endpoints: [{ method: "GET", path: "/test", covers_features: ["F-001"] }], models: ["TestModel"] } }),
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
