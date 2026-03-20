import path from 'node:path';
import type { StageName, GitHubConfig, ClarificationOption, GateResult, ReviewComment } from './types.js';
import type { InteractionHandler } from './interaction-handler.js';
import { CLIInteractionHandler } from './interaction-handler.js';
import type { GitPlatformAdapter, PRReview } from '../adapters/types.js';
import type { SecurityConfig } from './security.js';
import { isTrustedActor } from './security.js';
import { eventBus } from './event-bus.js';

export class GitHubInteractionHandler implements InteractionHandler {
  private adapter: GitPlatformAdapter;
  private githubConfig: GitHubConfig;
  private securityConfig: SecurityConfig;
  private prNumber: number | null = null;
  private lastReviewCount = 0; // track how many reviews we've seen
  private cliHandler: CLIInteractionHandler;

  constructor(
    adapter: GitPlatformAdapter,
    githubConfig: GitHubConfig,
    securityConfig: SecurityConfig,
    cliHandler?: CLIInteractionHandler,
  ) {
    this.adapter = adapter;
    this.githubConfig = githubConfig;
    this.securityConfig = securityConfig;
    this.cliHandler = cliHandler ?? new CLIInteractionHandler();
  }

  /** Set the PR number for review-based approvals (called by Orchestrator after PR is created) */
  setPR(prNumber: number): void {
    this.prNumber = prNumber;
  }

  async onManualGate(stage: StageName, runId: string): Promise<GateResult> {
    if (!this.prNumber) {
      // No PR yet — fall back to Issue-based approval
      return this.onManualGateViaIssue(stage, runId);
    }

    // Post comment on PR asking for review
    await this.adapter.addComment(this.prNumber, [
      `## 🔍 Review needed: **${stage}**`,
      '',
      `**Run:** \`${runId}\``,
      '',
      'Please review the artifacts in **Files Changed** and submit a PR review:',
      '- **Approve** to continue the pipeline',
      '- **Request Changes** to provide feedback (use line comments for precision)',
    ].join('\n'));

    // Record current review count so we only look at new reviews
    const existingReviews = await this.adapter.listReviews(this.prNumber);
    this.lastReviewCount = existingReviews.length;

    // Poll for new PR review
    return this.pollForReview(this.prNumber, stage);
  }

  async onClarification(
    stage: StageName, question: string, runId: string,
    options?: ClarificationOption[], allowCustom?: boolean,
    context?: string, impact?: string,
  ): Promise<string> {
    if (!this.prNumber) {
      // No PR — fall back to Issue-based clarification
      return this.onClarificationViaIssue(stage, question, runId);
    }

    // Terminal-first: if TTY available, interact locally then post audit trail
    if (process.stdin.isTTY) {
      const answer = await this.cliHandler.onClarification(
        stage, question, runId, options, allowCustom, context, impact,
      );

      // Post Q&A as informational audit comment on PR
      const auditLines = [
        `## 📋 Clarification resolved: **${stage}**`,
        '',
        `**Q:** ${question}`,
        `**A:** ${answer}`,
        '',
        '_Answered via terminal interaction._',
      ];
      await this.adapter.addComment(this.prNumber, auditLines.join('\n'));

      return answer;
    }

    // No TTY (CI mode) — fall back to PR comment + polling
    const lines = [
      `## ❓ Clarification needed: **${stage}**`,
      '',
    ];

    if (context) lines.push(`> **Context:** ${context}`);
    if (impact) lines.push(`> **Impact:** ${impact}`);
    if (context || impact) lines.push('');

    lines.push(question);

    if (options && options.length > 0) {
      lines.push('', '### Options');
      for (const opt of options) {
        const desc = opt.description ? ` — ${opt.description}` : '';
        lines.push(`- **${opt.label}**${desc}`);
      }
      if (allowCustom !== false) {
        lines.push('', '_You can also reply with a custom answer._');
      }
      lines.push('', 'Reply with the option name (e.g. `' + options[0].label + '`) or your own answer.');
    } else {
      lines.push('', 'Please reply to this comment with your answer.');
    }

    // Post clarification question as PR comment
    await this.adapter.addComment(this.prNumber, lines.join('\n'));

    // Poll for a reply comment (not a review)
    const answer = await this.pollForCommentReply(this.prNumber);
    eventBus.emit('clarification:answered', stage, question, answer, 'github');
    return answer;
  }

  private async pollForReview(prNumber: number, stage: StageName): Promise<GateResult> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;

    while (Date.now() < deadline) {
      const reviews = await this.adapter.listReviews(prNumber);

      // Only look at reviews submitted after our request
      const newReviews = reviews.slice(this.lastReviewCount);

      for (const review of newReviews) {
        if (!isTrustedActor(review.author, this.securityConfig)) continue;

        if (review.state === 'APPROVED') {
          this.lastReviewCount = reviews.length;
          return { approved: true };
        }

        if (review.state === 'CHANGES_REQUESTED') {
          this.lastReviewCount = reviews.length;
          return this.buildGateResultFromReview(prNumber, review);
        }
      }

      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`PR review timed out after ${this.githubConfig.poll_timeout_ms}ms for stage ${stage}`);
  }

  private async buildGateResultFromReview(prNumber: number, review: PRReview): Promise<GateResult> {
    const result: GateResult = {
      approved: false,
      feedback: review.body || undefined,
    };

    // Fetch line-level review comments
    const comments = await this.adapter.listReviewComments(prNumber);

    if (comments.length > 0) {
      result.comments = comments.map((c) => ({
        file: c.path,
        line: c.line,
        body: c.body,
        context: c.diffHunk,
      } satisfies ReviewComment));

      // Auto-infer retryComponents from file paths
      const componentPaths = comments
        .filter((c) => c.path.includes('components/'))
        .map((c) => path.basename(c.path, '.tsx'));
      if (componentPaths.length > 0) {
        result.retryComponents = [...new Set(componentPaths)];
      }
    }

    return result;
  }

  private async pollForCommentReply(prNumber: number): Promise<string> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;
    const sinceTime = new Date().toISOString();

    while (Date.now() < deadline) {
      // PR comments are issue comments (PRs are issues in GitHub)
      const comments = await this.adapter.getComments(prNumber, sinceTime);

      for (const comment of comments) {
        if (!isTrustedActor(comment.author, this.securityConfig)) continue;
        // Skip bot comments (from mosaicat[bot] or any [bot] account, or starting with ##)
        if (comment.author.endsWith('[bot]')) continue;
        if (comment.body.startsWith('## ')) continue;
        return comment.body;
      }

      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`Clarification reply timed out after ${this.githubConfig.poll_timeout_ms}ms`);
  }

  // ── Fallback: Issue-based flow (when no PR exists yet) ──

  private async onManualGateViaIssue(stage: StageName, runId: string): Promise<GateResult> {
    const issue = await this.adapter.createIssue({
      title: `[${stage}] review: ${runId}`,
      body: [
        `## Manual Gate Review`,
        '',
        `**Stage:** ${stage}`,
        `**Run:** ${runId}`,
        '',
        'Please review the artifacts and respond with `/approve` or `/reject [feedback]`.',
      ].join('\n'),
      labels: [`agent:${stage}`, 'status:review-needed'],
    });

    const since = new Date().toISOString();
    const result = await this.pollForIssueDecision(issue.number, since);

    await this.adapter.removeLabel(issue.number, 'status:review-needed').catch(() => {});
    await this.adapter.addLabels(issue.number, [result.approved ? 'status:approved' : 'status:rejected']);
    await this.adapter.closeIssue(issue.number);

    return result;
  }

  private async onClarificationViaIssue(stage: StageName, question: string, runId: string): Promise<string> {
    const issue = await this.adapter.createIssue({
      title: `[${stage}] clarification: ${runId}`,
      body: `## Clarification Needed\n\n**Stage:** ${stage}\n**Run:** ${runId}\n\n### Question\n${question}\n\nPlease respond with your answer.`,
      labels: [`agent:${stage}`, 'status:clarification-needed'],
    });

    const since = new Date().toISOString();
    const answer = await this.pollForIssueAnswer(issue.number, since);

    await this.adapter.removeLabel(issue.number, 'status:clarification-needed').catch(() => {});
    await this.adapter.addLabels(issue.number, ['status:clarification-answered']);
    await this.adapter.closeIssue(issue.number);

    return answer;
  }

  private async pollForIssueDecision(issueNumber: number, since: string): Promise<GateResult> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;

    while (Date.now() < deadline) {
      const comments = await this.adapter.getComments(issueNumber, since);

      for (const comment of comments) {
        if (!isTrustedActor(comment.author, this.securityConfig)) continue;
        const bodyLower = comment.body.toLowerCase().trim();

        for (const keyword of this.githubConfig.approve_keywords) {
          if (bodyLower.includes(keyword.toLowerCase())) return { approved: true };
        }
        for (const keyword of this.githubConfig.reject_keywords) {
          if (bodyLower.includes(keyword.toLowerCase())) {
            const idx = bodyLower.indexOf(keyword.toLowerCase());
            const feedback = comment.body.slice(idx + keyword.length).trim();
            return { approved: false, feedback: feedback || undefined };
          }
        }
      }

      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`Manual gate timed out after ${this.githubConfig.poll_timeout_ms}ms`);
  }

  private async pollForIssueAnswer(issueNumber: number, since: string): Promise<string> {
    const deadline = Date.now() + this.githubConfig.poll_timeout_ms;

    while (Date.now() < deadline) {
      const comments = await this.adapter.getComments(issueNumber, since);
      for (const comment of comments) {
        if (isTrustedActor(comment.author, this.securityConfig)) return comment.body;
      }
      await this.sleep(this.githubConfig.poll_interval_ms);
    }

    throw new Error(`Clarification timed out after ${this.githubConfig.poll_timeout_ms}ms`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
