export interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueRef {
  number: number;
  url: string;
}

export interface IssueComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

export interface IssueDetails {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  createdAt: string;
  closedAt?: string;
}

export interface PRRef {
  number: number;
  url: string;
  branch: string;
}

// ── Git Data API types ──

export interface GitRef {
  ref: string;       // e.g. "refs/heads/mosaicat/run-123"
  sha: string;       // commit SHA the ref points to
}

export interface GitBlob {
  sha: string;
}

export interface GitTreeEntry {
  path: string;
  mode: '100644' | '100755' | '040000';  // file, executable, directory
  type: 'blob' | 'tree';
  sha: string;
}

export interface GitTree {
  sha: string;
}

export interface GitCommit {
  sha: string;
  treeSha: string;
}

// ── PR Review types ──

export interface PRReview {
  id: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string;
  author: string;
  submittedAt: string;
}

export interface PRReviewComment {
  id: number;
  path: string;
  line?: number;
  body: string;
  author: string;
  diffHunk?: string;
}

export interface GitPlatformAdapter {
  createIssue(params: CreateIssueParams): Promise<IssueRef>;
  addComment(issueNumber: number, body: string): Promise<void>;
  closeIssue(issueNumber: number): Promise<void>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  getComments(issueNumber: number, since?: string): Promise<IssueComment[]>;
  getIssue(issueNumber: number): Promise<IssueDetails>;
  createPR(params: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<PRRef>;
  markPRReady(prNumber: number): Promise<void>;

  // ── Git Data API (for GitPublisher) ──
  getRef(ref: string): Promise<GitRef>;
  createRef(ref: string, sha: string): Promise<GitRef>;
  updateRef(ref: string, sha: string): Promise<GitRef>;
  createBlob(content: string, encoding: 'utf-8' | 'base64'): Promise<GitBlob>;
  createTree(entries: GitTreeEntry[], baseTreeSha?: string): Promise<GitTree>;
  createCommit(message: string, treeSha: string, parentShas: string[]): Promise<GitCommit>;
  getCommit(sha: string): Promise<GitCommit>;
  /** Create or update a file via Contents API — works on empty repos */
  createFileContent(path: string, content: string, message: string): Promise<{ sha: string }>;

  // ── PR Review API ──
  listReviews(prNumber: number): Promise<PRReview[]>;
  listReviewComments(prNumber: number): Promise<PRReviewComment[]>;

  // ── Repository context ──
  getOwner(): string;
  getRepo(): string;
}
