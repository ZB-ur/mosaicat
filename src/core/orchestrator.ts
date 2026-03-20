import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig, AgentsConfig, StageName, PipelineRun, AgentContext, PipelineProfile } from './types.js';
import { ClarificationNeeded } from './types.js';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
} from './pipeline.js';
import type { LLMProvider } from './llm-provider.js';
import { createProvider } from './provider-factory.js';
import { createAgent } from './agent-factory.js';
import { buildContext } from './context-manager.js';
import { createSnapshot } from './snapshot.js';
import { eventBus } from './event-bus.js';
import { Logger } from './logger.js';
import type { InteractionHandler } from './interaction-handler.js';
import { GitHubInteractionHandler } from './github-interaction-handler.js';
import { CLIInteractionHandler } from './interaction-handler.js';
import type { GitPlatformAdapter } from '../adapters/types.js';
import { buildIssueBody, buildStageIssueTitle, buildSummaryIssueTitle } from './security.js';
import type { StageIssueParams } from './security.js';
import { GitPublisher } from './git-publisher.js';
import { generatePRBody } from './pr-body-generator.js';
import { extractManifestSummary } from './manifest.js';
import { IntentConsultantAgent } from '../agents/intent-consultant.js';
import { artifactExists } from './artifact.js';
const AGENT_DESC: Record<StageName, string> = {
  intent_consultant: '意图深挖',
  researcher: '市场调研 & 竞品分析',
  product_owner: '产品需求文档',
  ux_designer: 'UX 流程 & 组件清单',
  api_designer: 'API 规范设计',
  ui_designer: 'React 组件 & 截图',
  tech_lead: '技术方案设计',
  coder: '代码生成',
  reviewer: '代码审查',
  validator: '交叉验证报告',
  qa_lead: 'QA 计划',
  tester: '自动化测试',
};

interface StageMetrics {
  startTime: number;
  hadClarification: boolean;
  wasRejected: boolean;
  commitSha?: string;
  clarificationQA?: { question: string; answer: string };
  rejectionFeedback?: string;
}

export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;
  private handler: InteractionHandler;
  private adapter?: GitPlatformAdapter;
  private publisher?: GitPublisher;
  private stageIssues = new Map<string, number>();
  private stageMetrics = new Map<StageName, StageMetrics>();

  constructor(handler?: InteractionHandler, adapter?: GitPlatformAdapter) {
    this.pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;
    this.agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
    this.handler = handler ?? new CLIInteractionHandler();
    this.adapter = adapter;
  }

  async run(instruction: string, autoApprove = false, profile?: PipelineProfile): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;

    // Resolve stage list from profile
    const stageList = this.resolveStageList(profile);

    const pipelineRun = createPipelineRun(runId, instruction, autoApprove, stageList);
    const logger = new Logger(runId);
    const provider = createProvider(this.pipelineConfig);

    logger.pipeline('info', 'pipeline:start', { runId, instruction, profile: profile ?? 'default' });
    eventBus.emit('pipeline:start', runId, stageList);

    // Initialize GitPublisher for GitHub mode
    if (this.adapter) {
      this.publisher = new GitPublisher(this.adapter);
      try {
        await this.publisher.init(runId, instruction.slice(0, 80));
      } catch (err) {
        // Git publisher init failure is non-fatal — continue without it
        logger.pipeline('warn', 'git-publisher:init-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.publisher = undefined;
      }
    }

    try {
      // Intent Consultant: multi-turn dialogue before pipeline
      await this.runIntentConsultant(pipelineRun, provider, logger);

      // Filter stage list: skip intent_consultant (handled above)
      const pipelineStages = stageList.filter((s) => s !== 'intent_consultant');
      for (const stage of pipelineStages) {
        await this.executeStage(pipelineRun, stage, provider, logger);
      }

      // Post-run evolution analysis
      if (this.pipelineConfig.evolution?.enabled) {
        await this.runEvolution(runId, provider, logger);
      }

      pipelineRun.completedAt = new Date().toISOString();
      await this.createSummaryIssue(runId, instruction);

      // Publish PR (mark ready for review)
      if (this.publisher) {
        try {
          // Generate rich PR body with screenshots, preview links, token stats
          const adapterAny = this.adapter as { getOwner?: () => string; getRepo?: () => string };
          const owner = adapterAny.getOwner?.() ?? '';
          const repo = adapterAny.getRepo?.() ?? '';
          const branch = this.publisher.getBranch() ?? '';
          const prBody = (owner && repo && branch)
            ? generatePRBody({ runId, owner, repo, branch })
            : `## Pipeline Complete\n\nRun: ${runId}`;
          await this.publisher.publish(prBody);
        } catch (err) {
          logger.pipeline('warn', 'git-publisher:publish-failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.pipeline('info', 'pipeline:complete', { runId });
      eventBus.emit('pipeline:complete', runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.pipeline('error', 'pipeline:failed', { runId, error: message });
      eventBus.emit('pipeline:failed', runId, message);
      throw err;
    } finally {
      await logger.close();
    }

    return pipelineRun;
  }

  private resolveStageList(profile?: PipelineProfile): readonly StageName[] {
    const profiles = this.pipelineConfig.profiles;
    const resolvedProfile = profile ?? 'full';
    if (!profiles || !profiles[resolvedProfile]) {
      throw new Error(`Unknown pipeline profile: ${resolvedProfile}. Available: ${profiles ? Object.keys(profiles).join(', ') : 'none'}`);
    }
    return profiles[resolvedProfile];
  }

  private async executeStage(
    run: PipelineRun,
    stage: StageName,
    provider: LLMProvider,
    logger: Logger
  ): Promise<void> {
    const stageConfig = this.pipelineConfig.stages[stage]!;
    const maxRetries = stageConfig.retry_max;

    run.currentStage = stage;
    transitionStage(run, stage, 'running');
    logger.pipeline('info', 'stage:start', { stage });
    eventBus.emit('stage:start', stage, run.id);

    // Initialize metrics for this stage (only on first entry, not retries)
    if (!this.stageMetrics.has(stage)) {
      this.stageMetrics.set(stage, {
        startTime: Date.now(),
        hadClarification: false,
        wasRejected: false,
      });
    }

    try {
      // Build context (artifact isolation)
      const agentConfig = this.agentsConfig.agents[stage];
      const task = { runId: run.id, stage, instruction: run.instruction, autonomy: agentConfig?.autonomy };
      const context = buildContext(this.agentsConfig, task);

      // Create and execute agent (with clarification handling)
      await this.executeAgent(run, stage, provider, logger, context);

      // Commit stage artifacts before gate check (so reviewers can see them)
      await this.commitStageArtifacts(stage, run.id, logger);

      // Record commit SHA
      const metrics = this.stageMetrics.get(stage);
      if (metrics && this.publisher) {
        metrics.commitSha = this.publisher.getLastCommitSha() ?? undefined;
      }

      // Post preview comment for stages with visual outputs (before gate check)
      await this.postPreviewComment(stage, run.id, logger);

      // Gate check
      if (shouldAutoApprove(run, stageConfig)) {
        transitionStage(run, stage, 'done');
      } else {
        // Manual gate
        transitionStage(run, stage, 'awaiting_human');
        eventBus.emit('stage:awaiting_human', stage, run.id);
        logger.pipeline('info', 'stage:awaiting_human', { stage });

        const gateResult = await this.handler.onManualGate(stage, run.id);

        if (gateResult.approved) {
          transitionStage(run, stage, 'approved');
          eventBus.emit('stage:approved', stage, run.id);
          transitionStage(run, stage, 'done');
        } else {
          // Track rejection in metrics
          const rejMetrics = this.stageMetrics.get(stage);
          if (rejMetrics) {
            rejMetrics.wasRejected = true;
            rejMetrics.rejectionFeedback = gateResult.feedback;
          }

          transitionStage(run, stage, 'rejected');
          eventBus.emit('stage:rejected', stage, run.id);
          logger.pipeline('info', 'stage:rejected', {
            stage,
            feedback: gateResult.feedback,
            retryComponents: gateResult.retryComponents,
          });

          // Inject feedback into context for retry
          if (gateResult.feedback) {
            context.inputArtifacts.set(
              'rejection_feedback',
              `[source: reviewer] ${gateResult.feedback}`
            );
          }
          if (gateResult.retryComponents && gateResult.retryComponents.length > 0) {
            context.inputArtifacts.set(
              'retry_components',
              JSON.stringify(gateResult.retryComponents)
            );
          }
          if (gateResult.comments && gateResult.comments.length > 0) {
            context.inputArtifacts.set(
              'review_comments',
              JSON.stringify(gateResult.comments)
            );
          }

          // Re-run the stage after rejection
          transitionStage(run, stage, 'idle');
          return this.executeStage(run, stage, provider, logger);
        }
      }

      // Snapshot (include issue numbers in metadata)
      const issueNumbers = Object.fromEntries(this.stageIssues);
      createSnapshot(stage, run.id, issueNumbers);
      eventBus.emit('snapshot:created', stage, run.id);

      // Create informational Issue on stage complete
      await this.createStageIssue(stage, run);

      logger.pipeline('info', 'stage:complete', { stage });
      eventBus.emit('stage:complete', stage, run.id);

      // Stage-level evolution analysis (non-blocking)
      if (this.pipelineConfig.evolution?.enabled) {
        await this.runStageEvolution(run.id, stage, provider, logger);
      }
    } catch (err) {
      // ClarificationNeeded is handled inside executeAgent, not here
      const message = err instanceof Error ? err.message : String(err);
      const stageStatus = run.stages[stage]!;

      if (stageStatus.retryCount < maxRetries) {
        stageStatus.retryCount++;
        transitionStage(run, stage, 'failed');
        transitionStage(run, stage, 'idle');
        logger.pipeline('warn', 'stage:retry', { stage, retry: stageStatus.retryCount });
        eventBus.emit('stage:retry', stage, run.id, stageStatus.retryCount);
        return this.executeStage(run, stage, provider, logger);
      }

      // Rollback to previous stage
      const prev = getPreviousStage(run, stage);
      if (prev) {
        transitionStage(run, stage, 'failed');
        logger.pipeline('warn', 'stage:rollback', { from: stage, to: prev });
        eventBus.emit('stage:rollback', stage, prev, run.id);
        await this.closeRolledBackIssues(stage, run.id);
      }

      eventBus.emit('stage:failed', stage, run.id, message);
      throw err;
    }
  }

  private async commitStageArtifacts(stage: StageName, runId: string, logger: Logger): Promise<void> {
    if (!this.publisher) return;
    try {
      const agentConfig = this.agentsConfig.agents[stage]!;
      const files = (agentConfig.outputs ?? []).map((o: string) => `.mosaic/artifacts/${o}`);
      const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
      await this.publisher.commitStage(stage, files, issueNumber);

      // Notify handler about PR (created lazily after first commit)
      const pr = this.publisher.getPR();
      if (pr && this.handler instanceof GitHubInteractionHandler) {
        this.handler.setPR(pr.number);
      }
    } catch (err) {
      logger.pipeline('warn', 'git-publisher:commit-failed', {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Post a PR comment with embedded screenshots and preview links for visual stages.
   * Called after commitStageArtifacts, before gate check, so reviewers can see the output.
   */
  private async postPreviewComment(stage: StageName, _runId: string, logger: Logger): Promise<void> {
    if (!this.adapter || !this.publisher) return;
    const pr = this.publisher.getPR();
    if (!pr) return;

    // Only post for ui_designer (has screenshots + previews)
    if (stage !== 'ui_designer') return;

    const adapterAny = this.adapter as { getOwner?: () => string; getRepo?: () => string };
    const owner = adapterAny.getOwner?.() ?? '';
    const repo = adapterAny.getRepo?.() ?? '';
    const branch = this.publisher.getBranch() ?? '';
    if (!owner || !repo || !branch) return;

    try {
      const lines: string[] = ['## 🎨 UIDesigner — Component Preview', ''];

      // Screenshots
      const screenshotsDir = '.mosaic/artifacts/screenshots';
      const screenshots = this.safeReadDir(screenshotsDir).filter(f => f.endsWith('.png'));
      if (screenshots.length > 0) {
        lines.push('### Screenshots');
        lines.push('');
        for (const file of screenshots) {
          const name = file.replace('.png', '');
          const imgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.mosaic/artifacts/screenshots/${file}`;
          lines.push(`<details><summary>${name}</summary>`);
          lines.push('');
          lines.push(`![${name}](${imgUrl})`);
          lines.push('');
          lines.push('</details>');
          lines.push('');
        }
      }

      // Interactive preview links
      const previewsDir = '.mosaic/artifacts/previews';
      const previews = this.safeReadDir(previewsDir).filter(f => f.endsWith('.html'));
      if (previews.length > 0) {
        lines.push('### Interactive Previews');
        lines.push('');
        for (const file of previews) {
          const name = file.replace('.html', '');
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.mosaic/artifacts/previews/${file}`;
          const previewUrl = `https://htmlpreview.github.io/?${rawUrl}`;
          lines.push(`- [${name}](${previewUrl})`);
        }
        lines.push('');
      }

      // Gallery link
      if (fs.existsSync('.mosaic/artifacts/gallery.html')) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.mosaic/artifacts/gallery.html`;
        const galleryUrl = `https://htmlpreview.github.io/?${rawUrl}`;
        lines.push(`### [View Gallery](${galleryUrl})`);
        lines.push('');
      }

      if (screenshots.length > 0 || previews.length > 0) {
        await this.adapter.addComment(pr.number, lines.join('\n'));
      }
    } catch (err) {
      logger.pipeline('warn', 'preview-comment:failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private safeReadDir(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }

  private async executeAgent(
    run: PipelineRun,
    stage: StageName,
    provider: LLMProvider,
    logger: Logger,
    context: AgentContext
  ): Promise<void> {
    const agentConfig = this.agentsConfig.agents[stage];
    const agent = createAgent(stage, provider, logger, agentConfig?.autonomy);

    try {
      await agent.execute(context);
    } catch (err) {
      if (!(err instanceof ClarificationNeeded)) {
        throw err;
      }

      const stageConfig = this.pipelineConfig.stages[stage]!;
      if (!stageConfig.clarification) {
        // Stage doesn't support clarification, re-throw
        throw err;
      }

      // Handle clarification: one round
      const clMetrics = this.stageMetrics.get(stage);
      if (clMetrics) clMetrics.hadClarification = true;

      transitionStage(run, stage, 'awaiting_clarification');
      logger.pipeline('info', 'stage:clarification', { stage, question: err.question });

      let answer: string;
      if (run.autoApprove) {
        // Auto-select: last option (convention: default/fallback) or generic default
        const lastOption = err.options?.[err.options.length - 1];
        answer = lastOption?.label ?? 'default';
        logger.pipeline('info', 'stage:clarification-auto', {
          stage,
          answer,
          reason: 'auto-approve mode',
        });
        eventBus.emit('clarification:answered', stage, err.question, answer, 'auto-approve');
      } else {
        answer = await this.handler.onClarification(
          stage, err.question, run.id, err.options, err.allowCustom,
          err.context, err.impact,
        );
      }

      // Record Q&A for issue report
      if (clMetrics) clMetrics.clarificationQA = { question: err.question, answer };

      // Augment context with user answer
      context.inputArtifacts.set(
        'clarification_answer',
        `[source: user] ${answer}`
      );

      transitionStage(run, stage, 'running');

      // Re-run agent with augmented context
      const retryAgent = createAgent(stage, provider, logger, agentConfig?.autonomy);
      await retryAgent.execute(context);
    }
  }

  private async createStageIssue(stage: StageName, run: PipelineRun): Promise<void> {
    if (!this.adapter) return;

    const agentConfig = this.agentsConfig.agents[stage];
    if (!agentConfig) return; // no config for this stage
    const metrics = this.stageMetrics.get(stage);

    // Extract manifest summary from disk (zero LLM cost)
    const manifestName = (agentConfig.outputs ?? []).find((o: string) => o.endsWith('.manifest.json'));
    const manifestSummary = manifestName ? extractManifestSummary(manifestName) : [];

    // GitHub context for links
    const adapterAny = this.adapter as { getOwner?: () => string; getRepo?: () => string };
    const owner = adapterAny.getOwner?.() ?? '';
    const repo = adapterAny.getRepo?.() ?? '';
    const repoSlug = owner && repo ? `${owner}/${repo}` : undefined;
    const branch = this.publisher?.getBranch() ?? undefined;
    const prNumber = this.publisher?.getPR()?.number;

    // Collect screenshot files for image embedding
    const screenshots = this.collectScreenshots();

    const params: StageIssueParams = {
      agentId: stage,
      agentName: agentConfig.name,
      agentDesc: AGENT_DESC[stage],
      taskRef: run.id,
      instruction: run.instruction,
      inputs: agentConfig.inputs ?? [],
      outputs: agentConfig.outputs ?? [],
      durationMs: metrics ? Date.now() - metrics.startTime : undefined,
      retryCount: run.stages[stage]?.retryCount ?? 0,
      clarificationQA: metrics?.clarificationQA,
      rejectionFeedback: metrics?.rejectionFeedback,
      manifestSummary: manifestSummary.length > 0 ? manifestSummary : undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
      commitSha: metrics?.commitSha,
      repoSlug,
      branch,
      prNumber,
    };

    const issue = await this.adapter.createIssue({
      title: buildStageIssueTitle(params),
      body: buildIssueBody(params),
      labels: [`agent:${stage}`, 'status:completed'],
    });

    this.stageIssues.set(`${run.id}:${stage}`, issue.number);
    eventBus.emit('issue:created', issue.number, stage, run.id);
  }

  private collectScreenshots(): string[] {
    const dir = '.mosaic/artifacts/screenshots';
    try {
      return fs.readdirSync(dir)
        .filter((f: string) => f.endsWith('.png'))
        .map((f: string) => `screenshots/${f}`);
    } catch {
      return [];
    }
  }

  private async closeRolledBackIssues(stage: StageName, runId: string): Promise<void> {
    if (!this.adapter) return;

    const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
    if (!issueNumber) return;

    await this.adapter.addLabels(issueNumber, ['status:rolled-back']);
    await this.adapter.closeIssue(issueNumber);
    eventBus.emit('issue:closed', issueNumber, stage, runId);
  }

  private async createSummaryIssue(runId: string, instruction: string): Promise<void> {
    if (!this.adapter) return;

    const stageLinks = Array.from(this.stageIssues.entries())
      .filter(([key]) => key.startsWith(runId))
      .map(([key, num]) => {
        const stage = key.split(':')[1] as StageName;
        const name = this.agentsConfig.agents[stage]?.name ?? stage;
        const desc = AGENT_DESC[stage] ?? '';
        return `- **${name}** ${desc} — #${num}`;
      })
      .join('\n');

    const prRef = this.publisher?.getPR();
    const prLine = prRef ? `\n**PR:** #${prRef.number}` : '';

    await this.adapter.createIssue({
      title: buildSummaryIssueTitle(instruction),
      body: `## Pipeline Summary\n\n**Run:** \`${runId}\`${prLine}\n**Instruction:** ${instruction}\n\n### Stages\n${stageLinks}\n\n---\n_Generated by [Mosaicat](https://github.com/ZB-ur/mosaicat) pipeline_`,
      labels: ['pipeline:summary'],
    });
  }

  private async runIntentConsultant(
    run: PipelineRun,
    provider: LLMProvider,
    logger: Logger
  ): Promise<void> {
    // Skip if intent-brief.json already exists (resume / retry scenario)
    if (artifactExists('intent-brief.json')) {
      logger.pipeline('info', 'intent-consultant:skipped', { reason: 'brief already exists' });
      return;
    }

    logger.pipeline('info', 'intent-consultant:start', { runId: run.id });
    console.log(`\n\x1b[1m[0/6] IntentConsultant\x1b[0m \x1b[2m— 意图深挖\x1b[0m`);

    // Intent Consultant always uses CLI interaction (multi-turn dialogue needs terminal,
    // not GitHub Issue polling). GitHub mode kicks in after the brief is produced.
    const cliHandler = new CLIInteractionHandler();

    // Use 'researcher' as placeholder StageName — IntentConsultant is not a pipeline stage yet
    const placeholderStage = 'researcher' as StageName;
    const agent = new IntentConsultantAgent(
      placeholderStage,
      provider,
      logger,
      cliHandler,
    );

    const context: AgentContext = {
      systemPrompt: '',
      task: { runId: run.id, stage: placeholderStage, instruction: run.instruction },
      inputArtifacts: new Map([['user_instruction', run.instruction]]),
    };

    await agent.execute(context);
    logger.pipeline('info', 'intent-consultant:complete', { runId: run.id });
  }

  enableEvolution(): void {
    if (!this.pipelineConfig.evolution) {
      this.pipelineConfig.evolution = { enabled: true, cooldown_hours: 24 };
    } else {
      this.pipelineConfig.evolution.enabled = true;
    }
  }

  private async runStageEvolution(
    runId: string,
    stage: StageName,
    provider: LLMProvider,
    logger: Logger,
  ): Promise<void> {
    try {
      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');

      const engine = new EvolutionEngine(provider, logger);
      const proposals = await engine.analyzeStage(runId, stage);

      if (proposals.length > 0) {
        const handler = new ProposalHandler(this.handler, provider, logger);
        await handler.processProposals(proposals);
      }
    } catch (err) {
      logger.pipeline('error', 'evolution:stage-error', {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
      // Stage evolution errors don't fail the pipeline
    }
  }

  private async runEvolution(
    runId: string,
    provider: LLMProvider,
    logger: Logger
  ): Promise<void> {
    try {
      eventBus.emit('evolution:analyzing', runId);
      logger.pipeline('info', 'evolution:start', { runId });

      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');

      const engine = new EvolutionEngine(provider, logger);
      const proposals = await engine.analyze(runId);

      if (proposals.length > 0) {
        const handler = new ProposalHandler(this.handler, provider, logger);
        await handler.processProposals(proposals);
      }

      eventBus.emit('evolution:complete', runId, proposals.length);
      logger.pipeline('info', 'evolution:complete', { runId, proposalCount: proposals.length });
    } catch (err) {
      logger.pipeline('error', 'evolution:error', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Evolution errors don't fail the pipeline
    }
  }

  getStageIssues(): Map<string, number> {
    return new Map(this.stageIssues);
  }
}
