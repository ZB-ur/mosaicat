import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ToolUseAgent } from '../tool-use-agent.js';
import type { ToolUseOutputSpec } from '../tool-use-agent.js';
import {
  createTestRunContext,
  createTestArtifactStore,
} from '../../__tests__/test-helpers.js';
import type { RunContext } from '../../core/run-context.js';

// Concrete test subclass
class TestToolUseAgent extends ToolUseAgent {
  manifestData: unknown | undefined = undefined;

  getToolUseSpec(): ToolUseOutputSpec {
    return {
      artifacts: ['research.md'],
      manifest: 'research.manifest.json',
    };
  }

  protected parseManifest(_finalText: string): unknown | undefined {
    return this.manifestData;
  }
}

let lastCallOptions: LLMCallOptions | undefined;
let responseContent = 'Mock research content from web search';

function makeRunContext(): RunContext {
  lastCallOptions = undefined;
  const store = createTestArtifactStore();
  return createTestRunContext({
    store,
    provider: {
      async call(_prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
        lastCallOptions = options;
        return { content: responseContent };
      },
    },
  });
}

function makeContext(tools?: string[]): AgentContext {
  return {
    systemPrompt: '# Researcher Agent',
    task: {
      runId: 'test-run',
      stage: 'researcher',
      instruction: 'Research the market',
      autonomy: {
        allowed_tools: tools ?? ['WebSearch', 'WebFetch'],
        max_budget_usd: 0.5,
      },
    },
    inputArtifacts: new Map([
      ['intent-brief.json', '{"problem":"test problem"}'],
    ]),
  };
}

describe('ToolUseAgent', () => {
  let ctx: RunContext;
  let agent: TestToolUseAgent;

  beforeEach(() => {
    responseContent = 'Mock research content from web search';
    ctx = makeRunContext();
    agent = new TestToolUseAgent('researcher', ctx);
  });

  it('calls provider.call() with allowedTools from context', async () => {
    await agent.execute(makeContext(['WebSearch', 'WebFetch']));
    expect(lastCallOptions?.allowedTools).toEqual(['WebSearch', 'WebFetch']);
  });

  it('does NOT pass jsonSchema to provider.call()', async () => {
    await agent.execute(makeContext());
    expect(lastCallOptions?.jsonSchema).toBeUndefined();
  });

  it('writes response.content to artifact via writeOutput()', async () => {
    responseContent = 'Full research markdown content';
    await agent.execute(makeContext());
    const written = ctx.store.read('research.md');
    expect(written).toBe('Full research markdown content');
  });

  it('calls writeOutputManifest when parseManifest returns data', async () => {
    agent.manifestData = {
      competitors: ['A', 'B'],
      key_insights: ['insight1'],
      feasibility: 'high',
      risks: ['risk1'],
    };
    await agent.execute(makeContext());
    const manifest = JSON.parse(ctx.store.read('research.manifest.json'));
    expect(manifest.competitors).toEqual(['A', 'B']);
    expect(manifest.feasibility).toBe('high');
  });

  it('does NOT write manifest when parseManifest returns undefined', async () => {
    agent.manifestData = undefined;
    await agent.execute(makeContext());
    expect(ctx.store.exists('research.manifest.json')).toBe(false);
  });
});
