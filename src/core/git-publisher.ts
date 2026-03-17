import fs from 'node:fs';
import path from 'node:path';
import type { GitPlatformAdapter, PRRef, GitTreeEntry } from '../adapters/types.js';

export class GitPublisher {
  private adapter: GitPlatformAdapter;
  private branch: string | null = null;
  private prRef: PRRef | null = null;
  private headSha: string | null = null; // current commit SHA on our branch
  private runId: string | null = null;
  private title: string | null = null;

  constructor(adapter: GitPlatformAdapter) {
    this.adapter = adapter;
  }

  /** Create branch via API at pipeline start. PR is deferred until first commit. */
  async init(runId: string, title: string): Promise<string> {
    const timestamp = runId.replace('run-', '');
    this.branch = `mosaicat/run-${timestamp}`;
    this.runId = runId;
    this.title = title;

    // Get main branch HEAD SHA (handle empty repos)
    this.headSha = await this.getOrCreateMainRef();

    // Create branch ref pointing to same commit
    await this.adapter.createRef(`refs/heads/${this.branch}`, this.headSha);

    return this.branch;
  }

  /** Commit stage artifacts via API: read files → create blobs → tree → commit → update ref */
  async commitStage(stage: string, files: string[], issueNumber?: number): Promise<void> {
    if (!this.branch || !this.headSha) return;

    // Expand directory paths into individual files
    const resolvedFiles = this.resolveFiles(files);

    // Read files from disk and create blobs
    const treeEntries: GitTreeEntry[] = [];
    for (const filePath of resolvedFiles) {
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

    // Create Draft PR after first commit (now there's a diff vs main)
    if (!this.prRef) {
      this.prRef = await this.adapter.createPR({
        title: `[Mosaicat] ${this.title}`,
        body: `## Pipeline Run: ${this.runId}\n\n_Pipeline in progress..._`,
        head: this.branch,
        draft: true,
      });
    }
  }

  /** Update PR body and mark ready for review at pipeline end */
  async publish(prBody: string): Promise<PRRef | null> {
    if (!this.prRef) return null;

    await this.adapter.addComment(this.prRef.number, prBody);
    await this.adapter.markPRReady(this.prRef.number);

    return this.prRef;
  }

  getLastCommitSha(): string | null {
    return this.headSha;
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

  /** Expand a list of file/directory paths into individual file paths */
  private resolveFiles(paths: string[]): string[] {
    const result: string[] = [];
    for (const p of paths) {
      const resolved = path.resolve(p);
      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          this.walkDir(resolved, p, result);
        } else {
          result.push(p);
        }
      } catch {
        // Path doesn't exist — keep it so readFileAsBase64 returns null
        result.push(p);
      }
    }
    return result;
  }

  /** Recursively collect all files under a directory */
  private walkDir(absDir: string, relativeBase: string, out: string[]): void {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const absPath = path.join(absDir, entry.name);
      const relPath = path.join(relativeBase, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(absPath, relPath, out);
      } else {
        out.push(relPath);
      }
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
