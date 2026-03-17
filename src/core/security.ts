import type { PipelineConfig } from './types.js';

export enum TrustLevel {
  Initiator = 0,
  Orchestrator = 1,
  Agent = 2,
  External = 3,
}

export interface SecurityConfig {
  initiatorLogin: string;
  rejectPolicy: 'silent' | 'error';
}

export function loadSecurityConfig(
  pipelineConfig: PipelineConfig,
  initiatorLogin?: string,
): SecurityConfig {
  return {
    initiatorLogin:
      initiatorLogin ??
      pipelineConfig.security.initiator ??
      '',
    rejectPolicy: (pipelineConfig.security.reject_policy as 'silent' | 'error') ?? 'silent',
  };
}

export function isTrustedActor(login: string, config: SecurityConfig): boolean {
  if (!config.initiatorLogin) return false;
  return login === config.initiatorLogin;
}

export function assertTrustedActor(login: string, config: SecurityConfig): void {
  if (!isTrustedActor(login, config)) {
    throw new Error(`Untrusted actor: ${login} (expected: ${config.initiatorLogin})`);
  }
}

export interface StageIssueParams {
  agentId: string;
  agentName: string;
  agentDesc: string;
  taskRef: string;
  instruction: string;
  inputs: string[];
  outputs: string[];
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number; cost_usd?: number };
  retryCount?: number;
  // Process log
  clarificationQA?: { question: string; answer: string };
  rejectionFeedback?: string;
  // Manifest summary (extracted from *.manifest.json)
  manifestSummary?: string[];
  // Screenshot file names (relative to artifacts dir, e.g. "screenshots/Calculator.png")
  screenshots?: string[];
  // GitHub context for links
  commitSha?: string;
  repoSlug?: string;  // "owner/repo"
  branch?: string;    // for raw.githubusercontent.com URLs
  prNumber?: number;
}

export function buildStageIssueTitle(params: StageIssueParams): string {
  return `${params.agentName} — ${params.agentDesc}`;
}

export function buildIssueBody(params: StageIssueParams): string {
  const lines: string[] = [];

  // Header with context
  const prLink = params.prNumber && params.repoSlug
    ? ` · PR: [#${params.prNumber}](https://github.com/${params.repoSlug}/pull/${params.prNumber})`
    : '';
  lines.push(`> **Run:** \`${params.taskRef}\`${prLink}`);
  lines.push(`> **Instruction:** ${params.instruction}`);
  lines.push('');

  // Manifest summary — the most valuable section
  if (params.manifestSummary && params.manifestSummary.length > 0) {
    lines.push('### Summary');
    lines.push('');
    for (const item of params.manifestSummary) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Output files with GitHub links
  lines.push('### Artifacts');
  lines.push('');
  for (const o of params.outputs) {
    if (params.repoSlug && params.commitSha) {
      const url = `https://github.com/${params.repoSlug}/blob/${params.commitSha}/.mosaic/artifacts/${o}`;
      lines.push(`- [\`${o}\`](${url})`);
    } else {
      lines.push(`- \`${o}\``);
    }
  }
  lines.push('');

  // Screenshots — embedded as images
  if (params.screenshots && params.screenshots.length > 0 && params.repoSlug && params.branch) {
    lines.push('### Screenshots');
    lines.push('');
    for (const file of params.screenshots) {
      const name = file.replace(/^screenshots\//, '').replace(/\.png$/, '');
      const imgUrl = `https://raw.githubusercontent.com/${params.repoSlug}/${params.branch}/.mosaic/artifacts/${file}`;
      lines.push(`<details><summary>${name}</summary>`);
      lines.push('');
      lines.push(`![${name}](${imgUrl})`);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  // Process log — clarification, rejection
  const hasProcessLog = params.clarificationQA || params.rejectionFeedback;
  if (hasProcessLog) {
    lines.push('### Process');
    lines.push('');
    if (params.clarificationQA) {
      lines.push(`> **🔄 Clarification**`);
      lines.push(`> Q: ${params.clarificationQA.question}`);
      lines.push(`> A: ${params.clarificationQA.answer}`);
      lines.push('');
    }
    if (params.rejectionFeedback) {
      lines.push(`> **✏️ Rejected & revised**`);
      lines.push(`> Feedback: ${params.rejectionFeedback}`);
      lines.push('');
    }
  }

  // Execution metrics — compact row
  lines.push('<details>');
  lines.push('<summary>Execution details</summary>');
  lines.push('');
  const durationStr = params.durationMs != null ? formatDurationForIssue(params.durationMs) : '—';
  const metricsItems: string[] = [`**Duration:** ${durationStr}`];
  if (params.usage) {
    const costStr = params.usage.cost_usd != null ? ` ($${params.usage.cost_usd.toFixed(2)})` : '';
    metricsItems.push(`**Tokens:** in: ${params.usage.input_tokens.toLocaleString()} / out: ${params.usage.output_tokens.toLocaleString()}${costStr}`);
  }
  if (params.retryCount && params.retryCount > 0) {
    metricsItems.push(`**Retries:** ${params.retryCount}`);
  }
  if (params.commitSha && params.repoSlug) {
    const short = params.commitSha.slice(0, 7);
    metricsItems.push(`**Commit:** [\`${short}\`](https://github.com/${params.repoSlug}/commit/${params.commitSha})`);
  }
  lines.push(metricsItems.join(' · '));
  lines.push('');
  // Inputs
  lines.push(`**Inputs:** ${params.inputs.length > 0 ? params.inputs.map((i) => `\`${i}\``).join(', ') : '_none_'}`);
  lines.push('');
  lines.push('</details>');

  lines.push('');
  lines.push('---');
  lines.push('_Generated by [Mosaicat](https://github.com/ZB-ur/mosaicat) pipeline_');

  return lines.join('\n');
}

export function buildSummaryIssueTitle(instruction: string): string {
  const truncated = instruction.length > 60 ? instruction.slice(0, 57) + '...' : instruction;
  return `Pipeline 完成 — ${truncated}`;
}

function formatDurationForIssue(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec}s`;
}
