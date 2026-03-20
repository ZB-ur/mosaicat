import { Octokit } from '@octokit/rest';
import type {
  GitPlatformAdapter,
  CreateIssueParams,
  IssueRef,
  IssueComment,
  IssueDetails,
  PRRef,
  GitRef,
  GitBlob,
  GitTreeEntry,
  GitTree,
  GitCommit,
  PRReview,
  PRReviewComment,
} from './types.js';
import type { AuthConfig } from '../auth/types.js';
import { getInstallationToken } from '../auth/token-service.js';
import { loadCachedAuth } from '../auth/auth-store.js';
import { listInstallations } from '../auth/token-service.js';

export type TokenProvider = string | (() => Promise<string>);

export class GitHubAdapter implements GitPlatformAdapter {
  private octokit: Octokit;
  private tokenProvider: TokenProvider | null;
  private owner: string;
  private repo: string;

  /**
   * @param params.token - Static token string or async provider function.
   *   When a function is provided, Octokit is initialized with an empty auth string.
   *   Callers MUST call `refreshToken()` before making any API calls to obtain a
   *   valid token. The sole call site (`createGitHubAdapterFromAuth`) already does this.
   */
  constructor(params: { token: TokenProvider; owner: string; repo: string }) {
    this.tokenProvider = typeof params.token === 'function' ? params.token : null;
    const initialToken = typeof params.token === 'string' ? params.token : '';
    this.octokit = new Octokit({ auth: initialToken });
    this.owner = params.owner;
    this.repo = params.repo;
  }

  /**
   * Refresh the Octokit instance with a fresh token from the provider.
   * Call before long-running operations to ensure the token is still valid.
   */
  async refreshToken(): Promise<void> {
    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      this.octokit = new Octokit({ auth: token });
    }
  }

  async createIssue(params: CreateIssueParams): Promise<IssueRef> {
    const { data } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      labels: params.labels,
    });
    return { number: data.number, url: data.html_url };
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed',
    });
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels,
    });
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.octokit.issues.removeLabel({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      name: label,
    });
  }

  async getComments(issueNumber: number, since?: string): Promise<IssueComment[]> {
    const { data } = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      ...(since ? { since } : {}),
    });
    return data.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      author: c.user?.login ?? '',
      createdAt: c.created_at,
    }));
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    const { data } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      state: data.state as 'open' | 'closed',
      labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
      createdAt: data.created_at,
      closedAt: data.closed_at ?? undefined,
    };
  }
  async createPR(params: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<PRRef> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base ?? 'main',
      draft: params.draft ?? false,
    });
    return { number: data.number, url: data.html_url, branch: params.head };
  }

  async markPRReady(prNumber: number): Promise<void> {
    // GitHub REST API doesn't support marking as ready — use GraphQL
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    if (pr.draft) {
      await this.octokit.graphql(`
        mutation($id: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $id }) {
            pullRequest { id }
          }
        }
      `, { id: pr.node_id });
    }
  }

  // ── Git Data API ──

  async getRef(ref: string): Promise<GitRef> {
    const { data } = await this.octokit.git.getRef({
      owner: this.owner, repo: this.repo, ref,
    });
    return { ref: data.ref, sha: data.object.sha };
  }

  async createRef(ref: string, sha: string): Promise<GitRef> {
    const { data } = await this.octokit.git.createRef({
      owner: this.owner, repo: this.repo, ref, sha,
    });
    return { ref: data.ref, sha: data.object.sha };
  }

  async updateRef(ref: string, sha: string): Promise<GitRef> {
    // ref for updateRef should NOT include "refs/" prefix
    const shortRef = ref.startsWith('refs/') ? ref.slice(5) : ref;
    const { data } = await this.octokit.git.updateRef({
      owner: this.owner, repo: this.repo, ref: shortRef, sha,
    });
    return { ref: data.ref, sha: data.object.sha };
  }

  async createBlob(content: string, encoding: 'utf-8' | 'base64'): Promise<GitBlob> {
    const { data } = await this.octokit.git.createBlob({
      owner: this.owner, repo: this.repo, content, encoding,
    });
    return { sha: data.sha };
  }

  async createTree(entries: GitTreeEntry[], baseTreeSha?: string): Promise<GitTree> {
    const { data } = await this.octokit.git.createTree({
      owner: this.owner, repo: this.repo,
      tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha })),
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    });
    return { sha: data.sha };
  }

  async createCommit(message: string, treeSha: string, parentShas: string[]): Promise<GitCommit> {
    const { data } = await this.octokit.git.createCommit({
      owner: this.owner, repo: this.repo, message, tree: treeSha, parents: parentShas,
    });
    return { sha: data.sha, treeSha: data.tree.sha };
  }

  async getCommit(sha: string): Promise<GitCommit> {
    const { data } = await this.octokit.git.getCommit({
      owner: this.owner, repo: this.repo, commit_sha: sha,
    });
    return { sha: data.sha, treeSha: data.tree.sha };
  }

  async listReviews(prNumber: number): Promise<PRReview[]> {
    const { data } = await this.octokit.pulls.listReviews({
      owner: this.owner, repo: this.repo, pull_number: prNumber,
    });
    return data.map((r) => ({
      id: r.id,
      state: r.state as PRReview['state'],
      body: r.body ?? '',
      author: r.user?.login ?? '',
      submittedAt: r.submitted_at ?? '',
    }));
  }

  async listReviewComments(prNumber: number): Promise<PRReviewComment[]> {
    const { data } = await this.octokit.pulls.listReviewComments({
      owner: this.owner, repo: this.repo, pull_number: prNumber,
    });
    return data.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line ?? undefined,
      body: c.body,
      author: c.user?.login ?? '',
      diffHunk: c.diff_hunk,
    }));
  }

  async createFileContent(filePath: string, content: string, message: string): Promise<{ sha: string }> {
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner, repo: this.repo,
      path: filePath, message,
      content: Buffer.from(content).toString('base64'),
    });
    return { sha: data.commit.sha! };
  }

  getOwner(): string { return this.owner; }
  getRepo(): string { return this.repo; }
}

/**
 * Create adapter from resolved AuthConfig.
 * Uses a token provider that auto-refreshes installation tokens before expiry.
 */
export function createGitHubAdapterFromAuth(config: AuthConfig): GitHubAdapter {
  let currentToken = config.installationToken;
  let expiresAt = new Date(config.installationTokenExpiresAt).getTime();

  const tokenProvider: TokenProvider = async () => {
    // Refresh if within 5 minutes of expiry
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const cached = loadCachedAuth();
      if (!cached) throw new Error('Auth expired. Run `mosaicat login` again.');
      const installations = await listInstallations(cached.userToken);
      const target = installations
        .flatMap((i) => i.repositories.map((r) => ({ installationId: i.id, fullName: r.full_name })))
        .find((r) => r.fullName === `${config.owner}/${config.repo}`);
      if (!target) throw new Error('Installation no longer found for this repository.');
      const result = await getInstallationToken(target.installationId, cached.userToken);
      currentToken = result.token;
      expiresAt = new Date(result.expiresAt).getTime();
    }
    return currentToken;
  };

  return new GitHubAdapter({
    token: tokenProvider,
    owner: config.owner,
    repo: config.repo,
  });
}
