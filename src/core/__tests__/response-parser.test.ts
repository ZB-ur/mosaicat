import { describe, it, expect } from 'vitest';
import { parseResponse } from '../response-parser.js';

describe('parseResponse', () => {
  it('should parse a normal response with artifact and manifest', () => {
    const raw = `
Some preamble text.

<!-- ARTIFACT:research.md -->
## Market Overview
This is market research content.
<!-- END:research.md -->

<!-- MANIFEST:research.manifest.json -->
{"competitors": ["a", "b"], "key_insights": ["insight1"], "feasibility": "high", "risks": ["risk1"]}
<!-- END:MANIFEST -->
`;

    const result = parseResponse(raw, ['research.md'], 'research.manifest.json');

    expect(result.artifacts.get('research.md')).toBe(
      '## Market Overview\nThis is market research content.'
    );
    expect(result.manifest).toEqual({
      name: 'research.manifest.json',
      data: { competitors: ['a', 'b'], key_insights: ['insight1'], feasibility: 'high', risks: ['risk1'] },
    });
    expect(result.clarification).toBeUndefined();
  });

  it('should parse multiple artifacts', () => {
    const raw = `
<!-- ARTIFACT:components/LoginForm.tsx -->
export function LoginForm() { return <div>Login</div>; }
<!-- END:components/LoginForm.tsx -->

<!-- ARTIFACT:components/Header.tsx -->
export function Header() { return <header>Header</header>; }
<!-- END:components/Header.tsx -->
`;

    const result = parseResponse(raw, ['components/LoginForm.tsx', 'components/Header.tsx']);

    expect(result.artifacts.size).toBe(2);
    expect(result.artifacts.get('components/LoginForm.tsx')).toContain('LoginForm');
    expect(result.artifacts.get('components/Header.tsx')).toContain('Header');
  });

  it('should detect plain text clarification and return early', () => {
    const raw = `
<!-- CLARIFICATION -->
I need to understand: do you want a blog with comments or without?
<!-- END:CLARIFICATION -->
`;

    const result = parseResponse(raw, ['research.md'], 'research.manifest.json');

    expect(result.clarification).toBe(
      'I need to understand: do you want a blog with comments or without?'
    );
    expect(result.structuredClarification).toBeUndefined();
    expect(result.artifacts.size).toBe(0);
    expect(result.manifest).toBeUndefined();
  });

  it('should parse structured JSON clarification with options', () => {
    const raw = `
<!-- CLARIFICATION -->
{
  "question": "请确认设计方向：",
  "options": [
    { "label": "极简清爽", "description": "Apple 风格，大量留白" },
    { "label": "Material Design", "description": "Google 卡片式" },
    { "label": "使用默认", "description": "slate + blue-600 配色" }
  ],
  "allow_custom": true
}
<!-- END:CLARIFICATION -->
`;

    const result = parseResponse(raw, ['components/'], 'components.manifest.json');

    expect(result.clarification).toBeDefined();
    expect(result.structuredClarification).toBeDefined();
    expect(result.structuredClarification!.question).toBe('请确认设计方向：');
    expect(result.structuredClarification!.options).toHaveLength(3);
    expect(result.structuredClarification!.options![0].label).toBe('极简清爽');
    expect(result.structuredClarification!.options![0].description).toBe('Apple 风格，大量留白');
    expect(result.structuredClarification!.allowCustom).toBe(true);
    expect(result.artifacts.size).toBe(0);
  });

  it('should default allowCustom to true when not specified in JSON clarification', () => {
    const raw = `
<!-- CLARIFICATION -->
{
  "question": "Pick a style:",
  "options": [
    { "label": "Option A" },
    { "label": "Option B" }
  ]
}
<!-- END:CLARIFICATION -->
`;

    const result = parseResponse(raw, ['test.md']);

    expect(result.structuredClarification).toBeDefined();
    expect(result.structuredClarification!.allowCustom).toBe(true);
  });

  it('should fallback for single artifact without delimiters', () => {
    const raw = `## Market Overview
This is the full response content.

## Competitors
- CompA
- CompB

\`\`\`json
{"competitors": ["CompA", "CompB"], "key_insights": ["insight"], "feasibility": "medium", "risks": []}
\`\`\``;

    const result = parseResponse(raw, ['research.md'], 'research.manifest.json');

    expect(result.artifacts.get('research.md')).toContain('## Market Overview');
    expect(result.artifacts.get('research.md')).not.toContain('```json');
    expect(result.manifest?.data).toEqual({
      competitors: ['CompA', 'CompB'],
      key_insights: ['insight'],
      feasibility: 'medium',
      risks: [],
    });
  });

  it('should handle manifest with code fences inside delimiters', () => {
    const raw = `
<!-- ARTIFACT:prd.md -->
## Goal
Build a blog.
<!-- END:prd.md -->

<!-- MANIFEST:prd.manifest.json -->
\`\`\`json
{"features": ["f1"], "constraints": ["c1"], "out_of_scope": ["x1"]}
\`\`\`
<!-- END:MANIFEST -->
`;

    const result = parseResponse(raw, ['prd.md'], 'prd.manifest.json');

    expect(result.manifest?.data).toEqual({
      features: ['f1'],
      constraints: ['c1'],
      out_of_scope: ['x1'],
    });
  });

  it('should throw on malformed manifest JSON', () => {
    const raw = `
<!-- ARTIFACT:prd.md -->
Content
<!-- END:prd.md -->

<!-- MANIFEST:prd.manifest.json -->
{invalid json here}
<!-- END:MANIFEST -->
`;

    expect(() => parseResponse(raw, ['prd.md'], 'prd.manifest.json')).toThrow(
      'Failed to parse manifest JSON'
    );
  });

  it('should return empty artifacts when no delimiters match and multiple expected', () => {
    const raw = 'Some random text without any delimiters';
    const result = parseResponse(raw, ['a.md', 'b.md']);

    expect(result.artifacts.size).toBe(0);
  });
});
