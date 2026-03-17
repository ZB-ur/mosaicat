import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubInteractionHandler } from '../github-interaction-handler.js';
import type { GitPlatformAdapter, CreateIssueParams, IssueComment, IssueDetails, PRRef, GitRef, GitBlob, GitTreeEntry, GitTree, GitCommit } from '../../adapters/types.js';
import type { GitHubConfig } from '../types.js';
import type { SecurityConfig } from '../security.js';

class InMemoryAdapter implements GitPlatformAdapter {
  issues: Map<number, { title: string; body: string; state: 'open' | 'closed'; labels: string[] }> = new Map();
  comments: Map<number, IssueComment[]> = new Map();
  private nextIssueNumber = 1;

  async createIssue(params: CreateIssueParams) {
    const number = this.nextIssueNumber++;
    this.issues.set(number, {
      title: params.title,
      body: params.body,
      state: 'open',
      labels: params.labels ?? [],
    });
    this.comments.set(number, []);
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
    if (!since) return comments;
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

  // Test helper: simulate a user comment
  simulateComment(issueNumber: number, author: string, body: string) {
    const comments = this.comments.get(issueNumber) ?? [];
    comments.push({
      id: comments.length + 1,
      body,
      author,
      createdAt: new Date().toISOString(),
    });
    this.comments.set(issueNumber, comments);
  }
}

const githubConfig: GitHubConfig = {
  enabled: true,
  poll_interval_ms: 10, // fast polling for tests
  poll_timeout_ms: 500,
  approve_keywords: ['/approve'],
  reject_keywords: ['/reject'],
};

const securityConfig: SecurityConfig = {
  initiatorLogin: 'trusted-user',
  rejectPolicy: 'silent',
};

describe('GitHubInteractionHandler', () => {
  let adapter: InMemoryAdapter;
  let handler: GitHubInteractionHandler;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
    handler = new GitHubInteractionHandler(adapter, githubConfig, securityConfig);
  });

  describe('onManualGate', () => {
    it('should create issue and approve when trusted actor comments /approve', async () => {
      // Schedule approval after a small delay
      const gatePromise = handler.onManualGate('product_owner', 'run-1');

      // Wait for issue to be created then approve
      await sleep(30);
      adapter.simulateComment(1, 'trusted-user', '/approve');

      const result = await gatePromise;
      expect(result.approved).toBe(true);

      // Issue should be closed with approved label
      const issue = adapter.issues.get(1)!;
      expect(issue.state).toBe('closed');
      expect(issue.labels).toContain('status:approved');
      expect(issue.labels).not.toContain('status:review-needed');

      // Issue was created for this gate (fallback Issue flow)
      expect(adapter.issues.get(1)!.title).toContain('product_owner');
    });

    it('should reject when trusted actor comments /reject', async () => {
      const gatePromise = handler.onManualGate('ui_designer', 'run-2');

      await sleep(30);
      adapter.simulateComment(1, 'trusted-user', '/reject');

      const result = await gatePromise;
      expect(result.approved).toBe(false);

      const issue = adapter.issues.get(1)!;
      expect(issue.state).toBe('closed');
      expect(issue.labels).toContain('status:rejected');
    });

    it('should ignore untrusted actor comments', async () => {
      const gatePromise = handler.onManualGate('product_owner', 'run-3');

      await sleep(30);
      // Untrusted user approves — should be ignored
      adapter.simulateComment(1, 'untrusted-user', '/approve');

      // Then trusted user rejects
      await sleep(30);
      adapter.simulateComment(1, 'trusted-user', '/reject');

      const result = await gatePromise;
      expect(result.approved).toBe(false);
    });

    it('should timeout when no decision is made', async () => {
      const shortConfig: GitHubConfig = { ...githubConfig, poll_timeout_ms: 100 };
      const shortHandler = new GitHubInteractionHandler(adapter, shortConfig, securityConfig);

      await expect(shortHandler.onManualGate('product_owner', 'run-4')).rejects.toThrow('timed out');
    });
  });

  describe('onClarification', () => {
    it('should create issue and return trusted actor answer', async () => {
      const clarificationPromise = handler.onClarification(
        'researcher',
        'What is the target audience?',
        'run-5',
      );

      await sleep(30);
      adapter.simulateComment(1, 'trusted-user', 'Enterprise SaaS teams');

      const answer = await clarificationPromise;
      expect(answer).toBe('Enterprise SaaS teams');

      const issue = adapter.issues.get(1)!;
      expect(issue.state).toBe('closed');
      expect(issue.labels).toContain('status:clarification-answered');
    });

    it('should ignore untrusted actor answers', async () => {
      const clarificationPromise = handler.onClarification(
        'researcher',
        'What is the target?',
        'run-6',
      );

      await sleep(30);
      adapter.simulateComment(1, 'untrusted-user', 'Wrong answer');
      await sleep(30);
      adapter.simulateComment(1, 'trusted-user', 'Correct answer');

      const answer = await clarificationPromise;
      expect(answer).toBe('Correct answer');
    });

    it('should timeout when no answer is given', async () => {
      const shortConfig: GitHubConfig = { ...githubConfig, poll_timeout_ms: 100 };
      const shortHandler = new GitHubInteractionHandler(adapter, shortConfig, securityConfig);

      await expect(
        shortHandler.onClarification('researcher', 'question?', 'run-7'),
      ).rejects.toThrow('timed out');
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
