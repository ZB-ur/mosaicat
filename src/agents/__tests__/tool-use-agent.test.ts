import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ToolUseAgent } from '../tool-use-agent.js';
import type { ToolUseOutputSpec } from '../tool-use-agent.js';
import { Logger } from '../../core/logger.js';

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

class MockProvider implements LLMProvider {
  lastOptions?: LLMCallOptions;
  responseContent = 'Mock research content from web search';

  async call(_prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    this.lastOptions = options;
    return { content: this.responseContent };
  }
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
  let provider: MockProvider;
  let agent: TestToolUseAgent;
  let logger: Logger;

  beforeEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
    fs.mkdirSync('.mosaic/artifacts', { recursive: true });

    provider = new MockProvider();
    logger = new Logger('test-run');
    agent = new TestToolUseAgent('researcher', provider, logger);
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('calls provider.call() with allowedTools from context', async () => {
    await agent.execute(makeContext(['WebSearch', 'WebFetch']));
    expect(provider.lastOptions?.allowedTools).toEqual(['WebSearch', 'WebFetch']);
  });

  it('does NOT pass jsonSchema to provider.call()', async () => {
    await agent.execute(makeContext());
    expect(provider.lastOptions?.jsonSchema).toBeUndefined();
  });

  it('writes response.content to artifact via writeOutput()', async () => {
    provider.responseContent = 'Full research markdown content';
    await agent.execute(makeContext());
    const written = fs.readFileSync('.mosaic/artifacts/research.md', 'utf-8');
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
    const manifest = JSON.parse(
      fs.readFileSync('.mosaic/artifacts/research.manifest.json', 'utf-8'),
    );
    expect(manifest.competitors).toEqual(['A', 'B']);
    expect(manifest.feasibility).toBe('high');
  });

  it('does NOT write manifest when parseManifest returns undefined', async () => {
    agent.manifestData = undefined;
    await agent.execute(makeContext());
    expect(fs.existsSync('.mosaic/artifacts/research.manifest.json')).toBe(false);
  });
});
