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
}
