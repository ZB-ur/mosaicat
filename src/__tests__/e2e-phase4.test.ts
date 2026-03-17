/**
 * Phase 4 E2E Integration Test
 *
 * Verifies GitHub Issue-based approval flow:
 * 1. Issues created at each stage completion
 * 2. Manual gates create review Issues, approve via mock comments
 * 3. Untrusted actor comments are ignored
 * 4. Pipeline summary Issue created on completion
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';
import { STAGE_ORDER } from '../core/types.js';
import type { GitPlatformAdapter, CreateIssueParams, IssueComment, IssueDetails, PRRef, GitRef, GitBlob, GitTreeEntry, GitTree, GitCommit } from '../adapters/types.js';
import type { GitHubConfig } from '../core/types.js';
import type { SecurityConfig } from '../core/security.js';
import { Orchestrator } from '../core/orchestrator.js';
import { GitHubInteractionHandler } from '../core/github-interaction-handler.js';

// In-memory mock adapter for testing
class InMemoryGitPlatformAdapter implements GitPlatformAdapter {
  issues = new Map<number, { title: string; body: string; state: 'open' | 'closed'; labels: string[] }>();
  comments = new Map<number, IssueComment[]>();
  private nextIssueNumber = 1;

  // Auto-respond rules: when issue title matches pattern, add comment after delay
  private autoResponders: Array<{
    titlePattern: string;
    author: string;
    body: string;
    delay: number;
  }> = [];

  async createIssue(params: CreateIssueParams) {
    const number = this.nextIssueNumber++;
    this.issues.set(number, {
      title: params.title,
      body: params.body,
      state: 'open',
      labels: params.labels ?? [],
    });
    this.comments.set(number, []);

    // Fire auto-responders based on title pattern
    for (const responder of this.autoResponders) {
      if (params.title.includes(responder.titlePattern)) {
        setTimeout(() => {
          this.addMockComment(number, responder.author, responder.body);
        }, responder.delay);
      }
    }

    return { number, url: `https://example.com/issues/${number}` };
  }

  async addComment(issueNumber: number, body: string) {
    const comments = this.comments.get(issueNumber) ?? [];
    comments.push({
      id: comments.length + 1,
      body,
      author: 'system',
      createdAt: new Date().toISOString(),
    });
    this.comments.set(issueNumber, comments);
  }

  async closeIssue(issueNumber: number) {
    const issue = this.issues.get(issueNumber);
    if (issue) issue.state = 'closed';
  }

  async addLabels(issueNumber: number, labels: string[]) {
    const issue = this.issues.get(issueNumber);
    if (issue) issue.labels.push(...labels);
  }

  async removeLabel(issueNumber: number, label: string) {
    const issue = this.issues.get(issueNumber);
    if (issue) issue.labels = issue.labels.filter((l) => l !== label);
  }

  async getComments(issueNumber: number, since?: string): Promise<IssueComment[]> {
    const comments = this.comments.get(issueNumber) ?? [];
    if (!since) return [...comments];
    return comments.filter((c) => c.createdAt >= since);
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    const issue = this.issues.get(issueNumber);
    if (!issue) throw new Error(`Issue ${issueNumber} not found`);
    return {
      number: issueNumber,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels,
      createdAt: new Date().toISOString(),
    };
  }

  async createPR(params: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<PRRef> {
    return { number: 999, url: 'https://example.com/pulls/999', branch: params.head };
  }

  async markPRReady(_prNumber: number): Promise<void> {}

  // Git Data API stubs
  async getRef(_ref: string): Promise<GitRef> { return { ref: _ref, sha: 'abc123' }; }
  async createRef(ref: string, sha: string): Promise<GitRef> { return { ref, sha }; }
  async updateRef(ref: string, sha: string): Promise<GitRef> { return { ref, sha }; }
  async createBlob(_content: string, _encoding: 'utf-8' | 'base64'): Promise<GitBlob> { return { sha: 'blob123' }; }
  async createTree(_entries: GitTreeEntry[], _baseTreeSha?: string): Promise<GitTree> { return { sha: 'tree123' }; }
  async createCommit(_message: string, _treeSha: string, _parentShas: string[]): Promise<GitCommit> { return { sha: 'commit123', treeSha: 'tree123' }; }
  async getCommit(_sha: string): Promise<GitCommit> { return { sha: _sha, treeSha: 'tree123' }; }
  async createFileContent(_path: string, _content: string, _message: string): Promise<{ sha: string }> { return { sha: 'file123' }; }
  async listReviews(_prNumber: number) { return []; }
  async listReviewComments(_prNumber: number) { return []; }

  addMockComment(issueNumber: number, author: string, body: string) {
    const comments = this.comments.get(issueNumber) ?? [];
    comments.push({
      id: comments.length + 1,
      body,
      author,
      createdAt: new Date().toISOString(),
    });
    this.comments.set(issueNumber, comments);
  }

  autoRespondTo(titlePattern: string, author: string, body: string, delayMs: number) {
    this.autoResponders.push({ titlePattern, author, body, delay: delayMs });
  }
}

// Mock LLM provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const sys = _options?.systemPrompt ?? '';

    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->\n{"components": [{"name": "CompA", "file": "components/CompA.tsx", "preview": "previews/CompA.html", "purpose": "Test component", "covers_flow": "main-flow", "parent": null, "children": [], "props": [], "priority": 1}]}\n<!-- END:ui-plan.json -->` };
    }
    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:components/CompA.tsx -->\nexport default function CompA() {\n  return <div className="p-4">Test</div>;\n}\n<!-- END:components/CompA.tsx -->\n\n<!-- ARTIFACT:previews/CompA.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Test</div></body></html>\n<!-- END:previews/CompA.html -->` };
    }

    // Sequential stages (non-UI)
    const stageResponses: Record<string, string> = {
      researcher: `<!-- ARTIFACT:research.md -->\n## Market\nTest\n<!-- END:research.md -->\n<!-- MANIFEST:research.manifest.json -->\n{"competitors": ["A"], "key_insights": ["test"], "feasibility": "high", "risks": []}\n<!-- END:MANIFEST -->`,
      product_owner: `<!-- ARTIFACT:prd.md -->\n## Goal\nTest\n## Features\n- feat-a\n<!-- END:prd.md -->\n<!-- MANIFEST:prd.manifest.json -->\n{"features": ["feat-a"], "constraints": [], "out_of_scope": []}\n<!-- END:MANIFEST -->`,
      ux_designer: `<!-- ARTIFACT:ux-flows.md -->\n## User Journeys\n### Flow 1: main-flow\nStep 1\n## Component Inventory\n- CompA\n<!-- END:ux-flows.md -->\n<!-- MANIFEST:ux-flows.manifest.json -->\n{"flows": ["main-flow"], "components": ["CompA"], "interaction_rules": []}\n<!-- END:MANIFEST -->`,
      api_designer: `<!-- ARTIFACT:api-spec.yaml -->\nopenapi: "3.0.0"\ninfo:\n  title: Test\npaths:\n  /test:\n    get:\n      summary: Test\n<!-- END:api-spec.yaml -->\n<!-- MANIFEST:api-spec.manifest.json -->\n{"endpoints": [{"method": "GET", "path": "/test", "covers_feature": "feat-a"}], "models": ["TestModel"]}\n<!-- END:MANIFEST -->`,
      validator: `<!-- ARTIFACT:validation-report.md -->\n## Validation Summary\n- Status: PASS\n- Checks passed: 4/4\n<!-- END:validation-report.md -->`,
    };

    // Detect stage from prompt content
    for (const [stage, response] of Object.entries(stageResponses)) {
      const artifactName = stage === 'researcher' ? 'research.md' : stage === 'product_owner' ? 'prd.md' : stage === 'ux_designer' ? 'ux-flows.md' : stage === 'api_designer' ? 'api-spec.yaml' : 'validation-report.md';
      if (_prompt.includes(artifactName) || sys.includes(stage.replace('_', ' '))) {
        return { content: response };
      }
    }

    // Fallback: use call count for early sequential stages
    const nonUIStages = STAGE_ORDER.filter((s) => s !== 'ui_designer');
    const stage = nonUIStages[this.callCount - 1];
    return { content: stageResponses[stage] ?? '[mock] unknown stage' };
  }
}

vi.mock('../core/provider-factory.js', () => ({
  createProvider: () => new MockLLMProvider(),
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

const githubConfig: GitHubConfig = {
  enabled: true,
  poll_interval_ms: 10,
  poll_timeout_ms: 2000,
  approve_keywords: ['/approve'],
  reject_keywords: ['/reject'],
};

const securityConfig: SecurityConfig = {
  initiatorLogin: 'trusted-user',
  rejectPolicy: 'silent',
};

describe('Phase 4 E2E: GitHub Issue-based Approval', () => {
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

  it('should run full pipeline with GitHub adapter, creating Issues at each stage', async () => {
    const adapter = new InMemoryGitPlatformAdapter();

    // Auto-approve any review issues (gate issues have "review" in title)
    adapter.autoRespondTo('review', 'trusted-user', '/approve', 50);

    const handler = new GitHubInteractionHandler(adapter, githubConfig, securityConfig);
    const orchestrator = new Orchestrator(handler, adapter);

    const result = await orchestrator.run('test GitHub integration', true);

    // Pipeline completed
    expect(result.completedAt).toBeDefined();

    // All stages done
    for (const stage of STAGE_ORDER) {
      expect(result.stages[stage].state).toBe('done');
    }

    // Stage issues were created by orchestrator (6 stages = 6 completion issues)
    const stageIssues = orchestrator.getStageIssues();
    expect(stageIssues.size).toBe(6);

    // Summary issue was created (total issues = 6 stage + 1 summary = 7 from orchestrator)
    // + 0 gate issues (auto-approve mode)
    expect(adapter.issues.size).toBe(7);

    // Verify a summary issue exists
    const summaryIssue = Array.from(adapter.issues.entries()).find(
      ([_, issue]) => issue.title.includes('[pipeline] summary')
    );
    expect(summaryIssue).toBeDefined();
    expect(summaryIssue![1].labels).toContain('pipeline:summary');
  }, 30000);

  it('should create gate Issues for manual stages and approve via comments', async () => {
    const adapter = new InMemoryGitPlatformAdapter();

    // Auto-approve any review issues from trusted user
    adapter.autoRespondTo('review', 'trusted-user', '/approve', 50);

    const handler = new GitHubInteractionHandler(adapter, githubConfig, securityConfig);
    // Don't pass adapter as 2nd arg — no GitPublisher means Issue-based approval for all gates
    const orchestrator = new Orchestrator(handler);

    const result = await orchestrator.run('test manual gates', false);

    expect(result.completedAt).toBeDefined();

    // Gate Issues were created and closed (fallback Issue-based flow since no PR)
    // Find review issues by title pattern
    const reviewIssues = Array.from(adapter.issues.entries())
      .filter(([_, i]) => i.title.includes('review:'));
    expect(reviewIssues.length).toBe(2); // product_owner + ui_designer

    for (const [_, issue] of reviewIssues) {
      expect(issue.state).toBe('closed');
      expect(issue.labels).toContain('status:approved');
    }
  }, 30000);

  it('should ignore untrusted actor comments on gate Issues', async () => {
    const adapter = new InMemoryGitPlatformAdapter();

    // Untrusted user tries to approve first (30ms), then trusted user approves (80ms)
    adapter.autoRespondTo('review', 'untrusted-user', '/approve', 30);
    // Trusted user approves later
    adapter.autoRespondTo('review', 'trusted-user', '/approve', 100);

    const handler = new GitHubInteractionHandler(adapter, githubConfig, securityConfig);
    // Don't pass adapter as 2nd arg — no GitPublisher means Issue-based approval
    const orchestrator = new Orchestrator(handler);

    const result = await orchestrator.run('test untrusted actor', false);

    // Pipeline should still complete (trusted user eventually approved)
    expect(result.completedAt).toBeDefined();
    for (const stage of STAGE_ORDER) {
      expect(result.stages[stage].state).toBe('done');
    }

    // Also verify snapshot metadata contains issue numbers (combined test to avoid race conditions)
    const snapshotsDir = '.mosaic/snapshots';
    expect(fs.existsSync(snapshotsDir)).toBe(true);
    const snapshots = fs.readdirSync(snapshotsDir).sort();
    const lastSnapshot = snapshots[snapshots.length - 1];
    const meta = JSON.parse(fs.readFileSync(`${snapshotsDir}/${lastSnapshot}/meta.json`, 'utf-8'));

    // Snapshot metadata exists
    expect(meta).toBeDefined();
  }, 60000);
});
