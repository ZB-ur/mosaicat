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
} from './types.js';

export class GitHubAdapter implements GitPlatformAdapter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(params: { token: string; owner: string; repo: string }) {
    this.octokit = new Octokit({ auth: params.token });
    this.owner = params.owner;
    this.repo = params.repo;
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
    return { sha: data.sha };
  }

  getOwner(): string { return this.owner; }
  getRepo(): string { return this.repo; }
}

export function createGitHubAdapter(): GitHubAdapter {
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.MOSAIC_GITHUB_REPO;

  if (!token) throw new Error('GITHUB_TOKEN environment variable is required');
  if (!repoSlug) throw new Error('MOSAIC_GITHUB_REPO environment variable is required (format: owner/repo)');

  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) throw new Error('MOSAIC_GITHUB_REPO must be in format: owner/repo');

  return new GitHubAdapter({ token, owner, repo });
}
