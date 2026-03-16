import type { StageName, GitHubConfig } from './types.js';
import type { InteractionHandler } from './interaction-handler.js';
import type { GitPlatformAdapter, IssueComment } from '../adapters/types.js';
import type { SecurityConfig } from './security.js';
import { isTrustedActor } from './security.js';

export class GitHubInteractionHandler implements InteractionHandler {
  private adapter: GitPlatformAdapter;
  private githubConfig: GitHubConfig;
  private securityConfig: SecurityConfig;
  private createdIssues = new Map<string, number>();

  constructor(
    adapter: GitPlatformAdapter,
    githubConfig: GitHubConfig,
    securityConfig: SecurityConfig,
  ) {
    this.adapter = adapter;
    this.githubConfig = githubConfig;
    this.securityConfig = securityConfig;
  }

  async onManualGate(stage: StageName, runId: string): Promise<boolean> {
    const issue = await this.adapter.createIssue({
      title: `[${stage}] review: ${runId}`,
      body: `## Manual Gate Review\n\n**Stage:** ${stage}\n**Run:** ${runId}\n\nPlease review the artifacts and respond with \`/approve\` or \`/reject\`.`,
      labels: [`agent:${stage}`, 'status:review-needed'],
    });

    this.createdIssues.set(`${runId}:${stage}`, issue.number);
    const since = new Date().toISOString();

    const result = await this.pollForDecision(issue.number, since);

    // Update issue labels
    await this.adapter.removeLabel(issue.number, 'status:review-needed').catch(() => {});
    await this.adapter.addLabels(issue.number, [result ? 'status:approved' : 'status:rejected']);
    await this.adapter.closeIssue(issue.number);

    return result;
  }

  async onClarification(stage: StageName, question: string, runId: string): Promise<string> {
    const issue = await this.adapter.createIssue({
      title: `[${stage}] clarification: ${runId}`,
      body: `## Clarification Needed\n\n**Stage:** ${stage}\n**Run:** ${runId}\n\n### Question\n${question}\n\nPlease respond with your answer.`,
      labels: [`agent:${stage}`, 'status:clarification-needed'],
    });

    this.createdIssues.set(`${runId}:${stage}:clarification`, issue.number);
    const since = new Date().toISOString();

    const answer = await this.pollForAnswer(issue.number, since);

    await this.adapter.removeLabel(issue.number, 'status:clarification-needed').catch(() => {});
    await this.adapter.addLabels(issue.number, ['status:clarification-answered']);
    await this.adapter.closeIssue(issue.number);

    return answer;
  }

  getCreatedIssues(): Map<string, number> {
    return new Map(this.createdIssues);
  }

  private async pollForDecision(issueNumber: number, since: string): Promise<boolean> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;

    while (Date.now() < deadline) {
      const comments = await this.adapter.getComments(issueNumber, since);
      const decision = this.findDecision(comments);

      if (decision !== null) {
        return decision;
      }

      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`Manual gate timed out after ${this.githubConfig.poll_timeout_ms}ms`);
  }

  private async pollForAnswer(issueNumber: number, since: string): Promise<string> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;

    while (Date.now() < deadline) {
      const comments = await this.adapter.getComments(issueNumber, since);
      const answer = this.findTrustedComment(comments);

      if (answer !== null) {
        return answer;
      }

      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`Clarification timed out after ${this.githubConfig.poll_timeout_ms}ms`);
  }

  private findDecision(comments: IssueComment[]): boolean | null {
    for (const comment of comments) {
      if (!isTrustedActor(comment.author, this.securityConfig)) {
        continue;
      }

      const bodyLower = comment.body.toLowerCase().trim();

      for (const keyword of this.githubConfig.approve_keywords) {
        if (bodyLower.includes(keyword.toLowerCase())) {
          return true;
        }
      }

      for (const keyword of this.githubConfig.reject_keywords) {
        if (bodyLower.includes(keyword.toLowerCase())) {
          return false;
        }
      }
    }

    return null;
  }

  private findTrustedComment(comments: IssueComment[]): string | null {
    for (const comment of comments) {
      if (isTrustedActor(comment.author, this.securityConfig)) {
        return comment.body;
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
