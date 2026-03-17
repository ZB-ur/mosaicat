import { execFileSync } from 'node:child_process';
import type { GitPlatformAdapter, PRRef } from '../adapters/types.js';
import { eventBus } from './event-bus.js';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

export class GitPublisher {
  private adapter: GitPlatformAdapter;
  private branch: string | null = null;
  private prRef: PRRef | null = null;

  constructor(adapter: GitPlatformAdapter) {
    this.adapter = adapter;
  }

  /** Create branch and Draft PR at pipeline start. Returns branch name. */
  async init(runId: string, title: string): Promise<string> {
    const timestamp = runId.replace('run-', '');
    this.branch = `mosaicat/run-${timestamp}`;

    // Create and push branch
    git('checkout', '-b', this.branch);
    // Create an initial empty commit so the branch exists on remote
    git('commit', '--allow-empty', '-m', `chore: init pipeline ${runId}`);
    git('push', '-u', 'origin', this.branch);

    // Create Draft PR
    this.prRef = await this.adapter.createPR({
      title: `[Mosaicat] ${title}`,
      body: `## Pipeline Run: ${runId}\n\n_Pipeline in progress..._`,
      head: this.branch,
      draft: true,
    });

    return this.branch;
  }

  /** Commit stage artifacts and push */
  async commitStage(stage: string, files: string[], issueNumber?: number): Promise<void> {
    if (!this.branch) return;

    // Stage files
    for (const file of files) {
      try {
        git('add', file);
      } catch {
        // File may not exist (e.g. screenshots skipped)
      }
    }

    // Check if there's anything to commit
    try {
      git('diff', '--cached', '--quiet');
      // No changes staged
      return;
    } catch {
      // Changes exist — proceed with commit
    }

    const issueRef = issueNumber ? ` (#${issueNumber})` : '';
    git('commit', '-m', `feat(${stage}): add ${stage} artifacts${issueRef}`);
    git('push', 'origin', this.branch);
  }

  /** Update PR body and mark ready for review at pipeline end */
  async publish(prBody: string): Promise<PRRef | null> {
    if (!this.prRef) return null;

    // Update PR body — use issue comment since REST can't update body easily
    // Actually, we can update via addComment on the PR (PRs are issues in GitHub)
    await this.adapter.addComment(this.prRef.number, prBody);

    // Mark as ready for review
    await this.adapter.markPRReady(this.prRef.number);

    return this.prRef;
  }

  getBranch(): string | null {
    return this.branch;
  }

  getPR(): PRRef | null {
    return this.prRef;
  }
}
