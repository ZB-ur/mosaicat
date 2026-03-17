import fs from 'node:fs';
import path from 'node:path';
import type { GitPlatformAdapter, PRRef, GitTreeEntry } from '../adapters/types.js';

export class GitPublisher {
  private adapter: GitPlatformAdapter;
  private branch: string | null = null;
  private prRef: PRRef | null = null;
  private headSha: string | null = null; // current commit SHA on our branch

  constructor(adapter: GitPlatformAdapter) {
    this.adapter = adapter;
  }

  /** Create branch via API and Draft PR at pipeline start. Returns branch name. */
  async init(runId: string, title: string): Promise<string> {
    const timestamp = runId.replace('run-', '');
    this.branch = `mosaicat/run-${timestamp}`;

    // Get main branch HEAD SHA (handle empty repos)
    this.headSha = await this.getOrCreateMainRef();

    // Create branch ref pointing to same commit
    await this.adapter.createRef(`refs/heads/${this.branch}`, this.headSha);

    // Create Draft PR
    this.prRef = await this.adapter.createPR({
      title: `[Mosaicat] ${title}`,
      body: `## Pipeline Run: ${runId}\n\n_Pipeline in progress..._`,
      head: this.branch,
      draft: true,
    });

    return this.branch;
  }

  /** Commit stage artifacts via API: read files → create blobs → tree → commit → update ref */
  async commitStage(stage: string, files: string[], issueNumber?: number): Promise<void> {
    if (!this.branch || !this.headSha) return;

    // Read files from disk and create blobs
    const treeEntries: GitTreeEntry[] = [];
    for (const filePath of files) {
      const content = this.readFileAsBase64(filePath);
      if (content === null) continue; // file doesn't exist

      const blob = await this.adapter.createBlob(content, 'base64');
      treeEntries.push({
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    if (treeEntries.length === 0) return; // nothing to commit

    // Get the tree SHA from the current HEAD commit (createTree needs a tree SHA, not commit SHA)
    const parentCommit = await this.adapter.getCommit(this.headSha);
    const tree = await this.adapter.createTree(treeEntries, parentCommit.treeSha);

    // Create commit
    const issueRef = issueNumber ? ` (#${issueNumber})` : '';
    const commit = await this.adapter.createCommit(
      `feat(${stage}): add ${stage} artifacts${issueRef}`,
      tree.sha,
      [this.headSha],
    );

    // Update branch ref
    await this.adapter.updateRef(`refs/heads/${this.branch}`, commit.sha);
    this.headSha = commit.sha;
  }

  /** Update PR body and mark ready for review at pipeline end */
  async publish(prBody: string): Promise<PRRef | null> {
    if (!this.prRef) return null;

    await this.adapter.addComment(this.prRef.number, prBody);
    await this.adapter.markPRReady(this.prRef.number);

    return this.prRef;
  }

  getBranch(): string | null {
    return this.branch;
  }

  getPR(): PRRef | null {
    return this.prRef;
  }

  /** Get main branch HEAD SHA, or initialize empty repo first */
  private async getOrCreateMainRef(): Promise<string> {
    try {
      const mainRef = await this.adapter.getRef('heads/main');
      return mainRef.sha;
    } catch {
      // Repo is likely empty (409) — Git Data API doesn't work on empty repos.
      // Use Contents API to create an initial file, which initializes the default branch.
      const result = await this.adapter.createFileContent(
        'README.md',
        '# Project\n\n_Initialized by Mosaicat pipeline_\n',
        'chore: initialize repository',
      );
      return result.sha;
    }
  }

  /** Read a file from disk and return base64-encoded content, or null if not found */
  private readFileAsBase64(filePath: string): string | null {
    try {
      const resolved = path.resolve(filePath);
      const buffer = fs.readFileSync(resolved);
      return buffer.toString('base64');
    } catch {
      return null;
    }
  }
}
