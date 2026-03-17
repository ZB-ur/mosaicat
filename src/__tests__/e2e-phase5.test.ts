/**
 * Phase 5 E2E Integration Test
 *
 * Verifies self-evolution system:
 * 1. Full pipeline run → evolution analysis → approval → prompt updated
 * 2. Re-run uses updated prompt
 * 3. Skill creation + injection into context
 * 4. Cooldown enforcement
 * 5. Rollback restores previous prompt
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions } from '../core/llm-provider.js';
import type { StageName } from '../core/types.js';
import { STAGE_ORDER } from '../core/types.js';
import type { InteractionHandler, EvolutionApprovalResult } from '../core/interaction-handler.js';
import type { EvolutionProposal } from '../evolution/types.js';
import { Orchestrator } from '../core/orchestrator.js';
import { buildContext } from '../core/context-manager.js';
import { listPromptVersions, rollbackPrompt } from '../evolution/prompt-versioning.js';
import { listSkills, loadSkillsForAgent } from '../evolution/skill-manager.js';
import { EvolutionEngine } from '../evolution/engine.js';
import { Logger } from '../core/logger.js';
import yaml from 'js-yaml';
import type { AgentsConfig } from '../core/types.js';

const PROMPT_FILE = '.claude/agents/mosaic/researcher.md';

// Mock LLM provider that tracks calls and returns stage-appropriate responses
// Also returns evolution proposals when called with evolution analyst prompt
class EvolutionMockProvider implements LLMProvider {
  callCount = 0;
  promptsSeen: string[] = [];
  systemPromptsSeen: string[] = [];

  // Configurable evolution response
  evolutionResponse: string = '[]';

  async call(prompt: string, options?: LLMCallOptions): Promise<string> {
    this.callCount++;
    this.promptsSeen.push(prompt);
    if (options?.systemPrompt) {
      this.systemPromptsSeen.push(options.systemPrompt);
    }

    // If this is an evolution analysis call (has evolution analyst system prompt)
    if (options?.systemPrompt?.includes('evolution analyst')) {
      return this.evolutionResponse;
    }

    // UIDesigner planner sub-phase
    const sys = options?.systemPrompt ?? '';
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return `<!-- ARTIFACT:ui-plan.json -->\n{"components": [{"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "Test", "covers_flow": "main-flow", "parent": null, "children": [], "props": [], "priority": 1}]}\n<!-- END:ui-plan.json -->`;
    }
    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return `<!-- ARTIFACT:components/CompA.tsx -->\nexport default function CompA() {\n  return <div className="p-4">Test</div>;\n}\n<!-- END:components/CompA.tsx -->\n\n<!-- ARTIFACT:previews/CompA.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Test</div></body></html>\n<!-- END:previews/CompA.html -->`;
    }

    // Normal pipeline stage responses
    const stageIdx = this.callCount - 1;
    const stage = STAGE_ORDER[stageIdx % STAGE_ORDER.length];

    const responses: Record<string, string> = {
      researcher: `<!-- ARTIFACT:research.md -->\n## Market\nTest\n<!-- END:research.md -->\n<!-- MANIFEST:research.manifest.json -->\n{"competitors": ["A"], "key_insights": ["test"], "feasibility": "high", "risks": []}\n<!-- END:MANIFEST -->`,
      product_owner: `<!-- ARTIFACT:prd.md -->\n## Goal\nTest\n## Features\n- feat-a\n<!-- END:prd.md -->\n<!-- MANIFEST:prd.manifest.json -->\n{"features": ["feat-a"], "constraints": [], "out_of_scope": []}\n<!-- END:MANIFEST -->`,
      ux_designer: `<!-- ARTIFACT:ux-flows.md -->\n## User Journeys\n### Flow 1: main-flow\nStep 1\n## Component Inventory\n- CompA\n<!-- END:ux-flows.md -->\n<!-- MANIFEST:ux-flows.manifest.json -->\n{"flows": ["main-flow"], "components": ["CompA"], "interaction_rules": []}\n<!-- END:MANIFEST -->`,
      api_designer: `<!-- ARTIFACT:api-spec.yaml -->\nopenapi: "3.0.0"\ninfo:\n  title: Test\npaths:\n  /test:\n    get:\n      summary: Test\n<!-- END:api-spec.yaml -->\n<!-- MANIFEST:api-spec.manifest.json -->\n{"endpoints": [{"method": "GET", "path": "/test", "covers_feature": "feat-a"}], "models": ["TestModel"]}\n<!-- END:MANIFEST -->`,
      ui_designer: `<!-- ARTIFACT:components/CompA.tsx -->\nexport default function CompA() {\n  return <div className="p-4">Test</div>;\n}\n<!-- END:components/CompA.tsx -->\n<!-- MANIFEST:components.manifest.json -->\n{"components": [{"name": "CompA", "file": "components/CompA.tsx", "covers_flow": "main-flow"}], "screenshots": []}\n<!-- END:MANIFEST -->`,
      validator: `<!-- ARTIFACT:validation-report.md -->\n## Validation Summary\n- Status: PASS\n- Checks passed: 4/4\n<!-- END:validation-report.md -->`,
    };

    return responses[stage] ?? '[mock] unknown';
  }
}

// Auto-approve interaction handler
class AutoApproveEvolutionHandler implements InteractionHandler {
  evolutionApprovals = new Map<string, EvolutionApprovalResult>();
  defaultApproval: EvolutionApprovalResult = { approved: true };
  proposalsSeen: EvolutionProposal[] = [];

  async onManualGate(_stage: StageName, _runId: string): Promise<boolean> {
    return true;
  }

  async onClarification(_stage: StageName, _question: string, _runId: string): Promise<string> {
    return 'test answer';
  }

  async onEvolutionProposal(proposal: EvolutionProposal): Promise<EvolutionApprovalResult> {
    this.proposalsSeen.push(proposal);
    return this.evolutionApprovals.get(proposal.id) ?? this.defaultApproval;
  }
}

// Shared provider reference — tests set this before creating orchestrator
let sharedProvider: EvolutionMockProvider = new EvolutionMockProvider();

vi.mock('../core/provider-factory.js', () => ({
  createProvider: () => sharedProvider,
}));

vi.mock('../core/agent-factory.js', async () => {
  const { ResearcherAgent } = await import('../agents/researcher.js');
  const { ProductOwnerAgent } = await import('../agents/product-owner.js');
  const { UXDesignerAgent } = await import('../agents/ux-designer.js');
  const { APIDesignerAgent } = await import('../agents/api-designer.js');
  const { UIDesignerAgent } = await import('../agents/ui-designer.js');
  const { ValidatorAgent } = await import('../agents/validator.js');

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

describe('Phase 5 E2E: Self-Evolution', () => {
  let originalPrompt: string;

  beforeEach(() => {
    originalPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  afterEach(() => {
    fs.writeFileSync(PROMPT_FILE, originalPrompt);
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('should run pipeline, propose evolution, approve, and update prompt', async () => {
    const provider = new EvolutionMockProvider();
    provider.evolutionResponse = JSON.stringify([
      {
        type: 'prompt_modification',
        agentStage: 'researcher',
        reason: 'Add deeper competitor analysis',
        proposedContent: '# Evolved Researcher\nYou must analyze at least 5 competitors.',
      },
    ]);

    // Set the mock provider
    sharedProvider = provider;

    const handler = new AutoApproveEvolutionHandler();
    const orchestrator = new Orchestrator(handler);
    orchestrator.enableEvolution();

    const result = await orchestrator.run('test evolution', true);

    // Pipeline completed
    expect(result.completedAt).toBeDefined();

    // Evolution proposal was presented
    expect(handler.proposalsSeen.length).toBe(1);
    expect(handler.proposalsSeen[0].type).toBe('prompt_modification');
    expect(handler.proposalsSeen[0].agentStage).toBe('researcher');

    // Prompt was updated
    const updatedPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
    expect(updatedPrompt).toBe('# Evolved Researcher\nYou must analyze at least 5 competitors.');

    // Version history exists
    const versions = listPromptVersions('researcher');
    expect(versions.length).toBeGreaterThan(0);
  }, 30000);

  it('should inject skills into agent context after skill creation', async () => {
    const provider = new EvolutionMockProvider();
    provider.evolutionResponse = JSON.stringify([
      {
        type: 'skill_creation',
        agentStage: 'researcher',
        reason: 'Reusable comparison framework',
        proposedContent: '# Comparison Framework\nUse tables for competitor comparison.',
        skillMetadata: {
          name: 'comparison-framework',
          scope: 'shared',
          description: 'Structured comparison using tables',
        },
      },
    ]);

    sharedProvider = provider;

    const handler = new AutoApproveEvolutionHandler();
    const orchestrator = new Orchestrator(handler);
    orchestrator.enableEvolution();

    await orchestrator.run('test skills', true);

    // Skill was created
    const skills = listSkills('researcher');
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('comparison-framework');

    // Skill is loaded for agent
    const loaded = loadSkillsForAgent('researcher');
    expect(loaded.size).toBe(1);
    expect(loaded.get('comparison-framework')).toContain('Comparison Framework');

    // Context includes skill in system prompt
    const agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
    const context = buildContext(agentsConfig, {
      runId: 'test',
      stage: 'researcher',
      instruction: 'test',
    });
    expect(context.systemPrompt).toContain('## Available Skills');
    expect(context.systemPrompt).toContain('comparison-framework');
  }, 30000);

  it('should enforce cooldown for prompt modifications', async () => {
    const logger = new Logger('test-cooldown');

    // Set up a recent cooldown in evolution state
    const engine = new EvolutionEngine(new EvolutionMockProvider(), logger);
    engine.saveState({
      proposals: [],
      promptVersions: {},
      cooldowns: {
        'researcher:prompt_modification': new Date().toISOString(),
      },
    });

    // Should not be able to propose for researcher
    expect(engine.canPropose('researcher', 'prompt_modification')).toBe(false);

    // But skill_creation should still be allowed
    expect(engine.canPropose('researcher', 'skill_creation')).toBe(true);

    // Other agents should be fine
    expect(engine.canPropose('product_owner', 'prompt_modification')).toBe(true);

    await logger.close();
  });

  it('should rollback prompt to a previous version', async () => {
    const provider = new EvolutionMockProvider();
    provider.evolutionResponse = JSON.stringify([
      {
        type: 'prompt_modification',
        agentStage: 'researcher',
        reason: 'Test rollback',
        proposedContent: '# Bad Prompt\nThis is a bad change.',
      },
    ]);

    sharedProvider = provider;

    const handler = new AutoApproveEvolutionHandler();
    const orchestrator = new Orchestrator(handler);
    orchestrator.enableEvolution();

    await orchestrator.run('test rollback', true);

    // Prompt was changed
    expect(fs.readFileSync(PROMPT_FILE, 'utf-8')).toBe('# Bad Prompt\nThis is a bad change.');

    // Rollback to version 1 (original snapshot)
    const versions = listPromptVersions('researcher');
    expect(versions.length).toBeGreaterThan(0);

    rollbackPrompt('researcher', 1);

    // Prompt should be restored to original
    expect(fs.readFileSync(PROMPT_FILE, 'utf-8')).toBe(originalPrompt);
  }, 30000);

  it('should reject proposals and not modify prompts', async () => {
    const provider = new EvolutionMockProvider();
    provider.evolutionResponse = JSON.stringify([
      {
        type: 'prompt_modification',
        agentStage: 'researcher',
        reason: 'Should be rejected',
        proposedContent: '# Rejected Change',
      },
    ]);

    sharedProvider = provider;

    const handler = new AutoApproveEvolutionHandler();
    handler.defaultApproval = { approved: false, reason: 'Too aggressive' };
    const orchestrator = new Orchestrator(handler);
    orchestrator.enableEvolution();

    await orchestrator.run('test rejection', true);

    // Prompt should NOT be changed
    expect(fs.readFileSync(PROMPT_FILE, 'utf-8')).toBe(originalPrompt);

    // Proposal was seen but rejected
    expect(handler.proposalsSeen.length).toBe(1);
  }, 30000);

  it('should handle evolution with no proposals gracefully', async () => {
    const provider = new EvolutionMockProvider();
    provider.evolutionResponse = '[]';

    sharedProvider = provider;

    const handler = new AutoApproveEvolutionHandler();
    const orchestrator = new Orchestrator(handler);
    orchestrator.enableEvolution();

    const result = await orchestrator.run('test no proposals', true);

    // Pipeline should complete normally
    expect(result.completedAt).toBeDefined();
    expect(handler.proposalsSeen.length).toBe(0);
  }, 30000);
});
