import { describe, it, expect } from 'vitest';
import { ResearcherAgent } from '../researcher.js';
import { ToolUseAgent } from '../tool-use-agent.js';
import { createTestRunContext } from '../../__tests__/test-helpers.js';

function makeAgent(): ResearcherAgent {
  const ctx = createTestRunContext();
  return new ResearcherAgent('researcher', ctx);
}

describe('ResearcherAgent', () => {
  it('extends ToolUseAgent (not LLMAgent)', () => {
    const agent = makeAgent();
    expect(agent).toBeInstanceOf(ToolUseAgent);
  });

  it('getToolUseSpec() returns correct spec', () => {
    const agent = makeAgent();
    const spec = agent.getToolUseSpec();
    expect(spec).toEqual({
      artifacts: ['research.md'],
      manifest: 'research.manifest.json',
    });
  });

  it('parseManifest() extracts JSON from ```json code block', () => {
    const agent = makeAgent();
    const text = `## Market Overview
Some research content here.

\`\`\`json
{"competitors":["A","B"],"key_insights":["i1"],"feasibility":"high","risks":["r1"]}
\`\`\`
`;
    // Access protected method via type cast for testing
    const result = (agent as unknown as { parseManifest(t: string): unknown }).parseManifest(text);
    expect(result).toEqual({
      competitors: ['A', 'B'],
      key_insights: ['i1'],
      feasibility: 'high',
      risks: ['r1'],
    });
  });

  it('parseManifest() returns undefined when no JSON block found', () => {
    const agent = makeAgent();
    const text = '## Market Overview\nJust plain text, no JSON block.';
    const result = (agent as unknown as { parseManifest(t: string): unknown }).parseManifest(text);
    expect(result).toBeUndefined();
  });
});
