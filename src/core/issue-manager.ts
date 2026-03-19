import type { GitPlatformAdapter, IssueRef } from '../adapters/types.js';
import type { StageName } from './types.js';
import { eventBus } from './event-bus.js';

export interface StepInfo {
  name: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  issueNumber?: number;
}

export class IssueManager {
  private adapter: GitPlatformAdapter;
  private stageIssues = new Map<string, number>(); // "runId:stage" → issue#
  private stepIssues = new Map<string, number>();   // "runId:stage:step" → issue#

  constructor(adapter: GitPlatformAdapter) {
    this.adapter = adapter;
  }

  /** Create a stage-level issue (e.g., [UIDesigner] React components) */
  async createStageIssue(
    stage: StageName,
    runId: string,
    description: string,
    steps?: StepInfo[],
  ): Promise<IssueRef> {
    const stepsTable = steps
      ? '\n\n### Steps\n' + steps.map((s) =>
          `| ${s.status === 'done' ? ':white_check_mark:' : ':hourglass:'} | ${s.label} | ${s.status} |`
        ).join('\n')
      : '';

    const issue = await this.adapter.createIssue({
      title: `[${stage}] ${description}`,
      body: `## Stage: ${stage}\n\n**Run:** ${runId}\n${stepsTable}`,
      labels: ['mosaicat:auto', 'mosaicat:stage', `agent:${stage}`],
    });

    this.stageIssues.set(`${runId}:${stage}`, issue.number);
    eventBus.emit('issue:created', issue.number, stage, runId);
    return issue;
  }

  /** Create a step-level issue under a stage issue */
  async createStepIssue(
    stage: StageName,
    runId: string,
    stepName: string,
    stepLabel: string,
  ): Promise<IssueRef> {
    const stageIssueNum = this.stageIssues.get(`${runId}:${stage}`);
    const parentRef = stageIssueNum ? `\n\nParent: #${stageIssueNum}` : '';

    const issue = await this.adapter.createIssue({
      title: `[${stage}/${stepName}] ${stepLabel}`,
      body: `## Step: ${stepLabel}${parentRef}\n\n**Run:** ${runId}`,
      labels: ['mosaicat:auto', 'mosaicat:step', `agent:${stage}`],
    });

    this.stepIssues.set(`${runId}:${stage}:${stepName}`, issue.number);
    return issue;
  }

  /** Update stage issue body with step statuses */
  async updateStageIssue(
    stage: StageName,
    runId: string,
    steps: StepInfo[],
  ): Promise<void> {
    const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
    if (!issueNumber) return;

    const stepsTable = steps.map((s) => {
      const icon = s.status === 'done' ? ':white_check_mark:'
        : s.status === 'running' ? ':hourglass:'
        : s.status === 'failed' ? ':x:'
        : ':black_circle:';
      const issueRef = s.issueNumber ? ` #${s.issueNumber}` : '';
      return `- ${icon} **${s.label}**${issueRef} — ${s.status}`;
    }).join('\n');

    await this.adapter.addComment(issueNumber, `### Step Progress\n${stepsTable}`);
  }

  /** Close a step issue */
  async closeStepIssue(stage: StageName, runId: string, stepName: string): Promise<void> {
    const issueNumber = this.stepIssues.get(`${runId}:${stage}:${stepName}`);
    if (!issueNumber) return;
    await this.adapter.closeIssue(issueNumber);
  }

  /** Close a stage issue */
  async closeStageIssue(stage: StageName, runId: string): Promise<void> {
    const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
    if (!issueNumber) return;
    await this.adapter.addLabels(issueNumber, ['status:completed']);
    await this.adapter.closeIssue(issueNumber);
    eventBus.emit('issue:closed', issueNumber, stage, runId);
  }

  getStageIssueNumber(stage: StageName, runId: string): number | undefined {
    return this.stageIssues.get(`${runId}:${stage}`);
  }

  getAllStageIssues(): Map<string, number> {
    return new Map(this.stageIssues);
  }
}
