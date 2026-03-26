import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig, AgentsConfig, StageName, PipelineRun, AgentContext, PipelineProfile } from './types.js';
import { ClarificationNeeded } from './types.js';
import {
  createPipelineRun,
  transitionStage,
  shouldAutoApprove,
  getPreviousStage,
  resetStageForResume,
} from './pipeline.js';
import { createProvider } from './provider-factory.js';
import { createAgent } from './agent-factory.js';
import { buildContext } from './context-manager.js';
import { createSnapshot } from './snapshot.js';
import { EventBus } from './event-bus.js';
import { Logger } from './logger.js';
import type { RunContext } from './run-context.js';
import { createRunContext } from './run-context.js';
import { ArtifactStore } from './artifact-store.js';
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
import { loadUserLLMConfig } from './llm-config-store.js';
import { logRetry, classifyError } from './retry-log.js';
import { RetryingProvider } from './retrying-provider.js';
import { loadResumeState, validateResumeState, findResumableRun, resetFromStage } from './resume.js';
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
  security_auditor: '安全审计',
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
  private evolutionEnabled: boolean;
  private devMode: boolean;
  private currentCtx?: RunContext;
  /** Shared EventBus for this orchestrator's lifetime. Subscribe before calling run(). */
  readonly eventBus: EventBus;

  constructor(
    handler?: InteractionHandler,
    adapter?: GitPlatformAdapter,
    options?: { enableEvolution?: boolean; devMode?: boolean },
  ) {
    this.pipelineConfig = yaml.load(
      fs.readFileSync('config/pipeline.yaml', 'utf-8')
    ) as PipelineConfig;
    this.agentsConfig = yaml.load(
      fs.readFileSync('config/agents.yaml', 'utf-8')
    ) as AgentsConfig;
    this.handler = handler ?? new CLIInteractionHandler();
    this.adapter = adapter;
    this.evolutionEnabled = options?.enableEvolution ?? false;
    this.devMode = options?.devMode ?? false;
    this.eventBus = new EventBus();
  }

  async run(instruction: string, autoApprove = false, profile?: PipelineProfile): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;

    // Resolve stage list from profile
    const stageList = this.resolveStageList(profile);

    const pipelineRun = createPipelineRun(runId, instruction, autoApprove, stageList);
    const store = new ArtifactStore('.mosaic/artifacts', runId);
    const logger = new Logger(runId);
    const provider = createProvider(this.pipelineConfig);
    const ctx = createRunContext({
      store,
      logger,
      provider,
      eventBus: this.eventBus,
      config: this.pipelineConfig,
      devMode: this.devMode,
    });
    this.currentCtx = ctx;
    const userLLMConfig = loadUserLLMConfig();
    const providerName = userLLMConfig?.provider ?? this.pipelineConfig.llm?.default ?? 'claude-cli';

    logger.pipeline('info', 'pipeline:start', { runId, instruction, profile: profile ?? 'default', artifactsDir: store.getDir(), provider: providerName });
    ctx.eventBus.emit('pipeline:start', runId, stageList, providerName);

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
      await this.runIntentConsultant(pipelineRun);

      // Filter stage list: skip intent_consultant (handled above)
      const pipelineStages = stageList.filter((s) => s !== 'intent_consultant');
      let testerCoderFixCount = 0;
      const MAX_FIX_ROUNDS = 5;
      const REPLAN_THRESHOLD = 3;
      const attemptHistory: Array<{ round: number; failures: string; approach: string }> = [];

      const resolvedProfile = profile ?? 'full';
      for (let i = 0; i < pipelineStages.length; i++) {
        const stage = pipelineStages[i];
        await this.executeStage(pipelineRun, stage);

        // Save state after each successful stage for resume support
        this.savePipelineState(pipelineRun, resolvedProfile, testerCoderFixCount);

        // Progressive Tester → Coder fix loop
        if (stage === 'tester' && testerCoderFixCount < MAX_FIX_ROUNDS) {
          const shouldRetry = this.checkTesterVerdict();
          if (shouldRetry) {
            testerCoderFixCount++;
            const round = testerCoderFixCount;

            let approach: string;
            if (round < REPLAN_THRESHOLD) {
              approach = 'direct-fix';
            } else if (round === REPLAN_THRESHOLD) {
              approach = 'replan-failed-modules';
            } else {
              approach = 'full-history-fix';
            }

            logger.pipeline('info', 'tester-coder-loop:start', {
              round,
              approach,
              historyLength: attemptHistory.length,
            });
            ctx.eventBus.emit('coder:fix-round', round, 0, 0, approach);

            // Log to retry-log
            logRetry({
              timestamp: new Date().toISOString(),
              runId: pipelineRun.id,
              stage: 'tester',
              source: 'tester-coder-loop',
              attempt: round,
              errorCategory: 'test-failure',
              errorMessage: 'Tester verdict: fail — triggering coder fix loop',
              resolved: false,
            });

            // Record failure history for cumulative context
            try {
              const failureData = ctx.store.read('test-report.manifest.json');
              attemptHistory.push({ round, failures: failureData, approach });
            } catch { /* non-fatal */ }

            const coderIdx = pipelineStages.indexOf('coder');
            if (coderIdx !== -1) {
              // Inject test failures + cumulative history
              this.injectTestFailuresForCoder(attemptHistory);
              // Reset coder and tester stages for re-run
              pipelineRun.stages['coder'] = { state: 'idle', retryCount: 0 };
              pipelineRun.stages['tester'] = { state: 'idle', retryCount: 0 };
              // Jump back to coder
              i = coderIdx - 1;
              continue;
            }
          }
        }
      }

      // Log final fix loop summary if any rounds occurred
      if (testerCoderFixCount > 0) {
        const finalVerdict = this.checkTesterVerdict() ? 'fail' : 'pass';
        logger.pipeline('info', 'tester-coder-loop:complete', {
          totalRounds: testerCoderFixCount,
          finalVerdict,
        });
      }

      // Post-run evolution analysis
      if (this.evolutionEnabled) {
        await this.runEvolution(runId);
      }

      pipelineRun.completedAt = new Date().toISOString();
      await this.createSummaryIssue(runId, instruction);

      // Publish PR (mark ready for review)
      if (this.publisher) {
        try {
          // Generate rich PR body with screenshots, preview links, token stats
          const { owner, repo } = this.getRepoContext();
          const branch = this.publisher.getBranch() ?? '';
          const prBody = (owner && repo && branch)
            ? generatePRBody({ runId, owner, repo, branch, artifactsDir: ctx.store.getDir() })
            : `## Pipeline Complete\n\nRun: ${runId}`;
          await this.publisher.publish(prBody);
        } catch (err) {
          ctx.logger.pipeline('warn', 'git-publisher:publish-failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      ctx.logger.pipeline('info', 'pipeline:complete', { runId });
      ctx.eventBus.emit('pipeline:complete', runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.pipeline('error', 'pipeline:failed', { runId, error: message });
      ctx.eventBus.emit('pipeline:failed', runId, message);
      throw err;
    } finally {
      await ctx.logger.close();
    }

    return pipelineRun;
  }

  /**
   * Resume a previously interrupted pipeline run.
   * Restores state from pipeline-state.json, skips completed stages, continues from where it stopped.
   */
  async resumeRun(runId?: string, fromStage?: string): Promise<PipelineRun> {
    const resolvedRunId = runId ?? findResumableRun();
    if (!resolvedRunId) {
      throw new Error('No resumable run found. Specify --run <runId> or ensure a pipeline-state.json exists.');
    }

    const store = new ArtifactStore('.mosaic/artifacts', resolvedRunId);
    const state = loadResumeState(resolvedRunId);

    // If --from specified, reset that stage and all downstream before validation
    if (fromStage) {
      const stageList = this.resolveStageList(state.profile as PipelineProfile);
      resetFromStage(state, fromStage as StageName, stageList);
      // Persist the reset state so subsequent crashes can resume correctly
      const statePath = `.mosaic/artifacts/${resolvedRunId}/pipeline-state.json`;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }

    const validated = validateResumeState(state, this.agentsConfig);

    const logger = new Logger(resolvedRunId);
    const provider = createProvider(this.pipelineConfig);
    const ctx = createRunContext({
      store,
      logger,
      provider,
      eventBus: this.eventBus,
      config: this.pipelineConfig,
      devMode: this.devMode,
    });
    this.currentCtx = ctx;
    const userLLMConfig = loadUserLLMConfig();
    const providerName = userLLMConfig?.provider ?? this.pipelineConfig.llm?.default ?? 'claude-cli';

    logger.pipeline('info', 'pipeline:resume', {
      runId: resolvedRunId,
      profile: validated.profile,
      provider: providerName,
      doneStages: Object.entries(validated.stages)
        .filter(([, s]) => s?.state === 'done')
        .map(([name]) => name),
    });

    const stageList = this.resolveStageList(validated.profile as PipelineProfile);
    const pipelineRun = createPipelineRun(resolvedRunId, validated.instruction, validated.autoApprove, stageList);

    // Restore completed stage states
    for (const [stage, status] of Object.entries(validated.stages)) {
      if (status && status.state === 'done') {
        pipelineRun.stages[stage as StageName] = status;
      }
    }

    ctx.eventBus.emit('pipeline:start', resolvedRunId, stageList, providerName);

    const pipelineStages = stageList.filter((s) => s !== 'intent_consultant');
    let testerCoderFixCount = validated.fixLoopRound ?? 0;

    try {
      // Intent Consultant: skip if brief exists (it should, since state was saved)
      await this.runIntentConsultant(pipelineRun);

      const MAX_FIX_ROUNDS = 5;
      const REPLAN_THRESHOLD = 3;
      const attemptHistory: Array<{ round: number; failures: string; approach: string }> = [];

      for (let i = 0; i < pipelineStages.length; i++) {
        const stage = pipelineStages[i];
        await this.executeStage(pipelineRun, stage);

        // Save state after each successful stage
        this.savePipelineState(pipelineRun, validated.profile, testerCoderFixCount);

        // Progressive Tester → Coder fix loop (same as run())
        if (stage === 'tester' && testerCoderFixCount < MAX_FIX_ROUNDS) {
          const shouldRetry = this.checkTesterVerdict();
          if (shouldRetry) {
            testerCoderFixCount++;
            const round = testerCoderFixCount;

            let approach: string;
            if (round < REPLAN_THRESHOLD) {
              approach = 'direct-fix';
            } else if (round === REPLAN_THRESHOLD) {
              approach = 'replan-failed-modules';
            } else {
              approach = 'full-history-fix';
            }

            logger.pipeline('info', 'tester-coder-loop:start', { round, approach, historyLength: attemptHistory.length });
            ctx.eventBus.emit('coder:fix-round', round, 0, 0, approach);

            logRetry({
              timestamp: new Date().toISOString(),
              runId: pipelineRun.id,
              stage: 'tester',
              source: 'tester-coder-loop',
              attempt: round,
              errorCategory: 'test-failure',
              errorMessage: 'Tester verdict: fail — triggering coder fix loop',
              resolved: false,
            });

            try {
              const failureData = ctx.store.read('test-report.manifest.json');
              attemptHistory.push({ round, failures: failureData, approach });
            } catch { /* non-fatal */ }

            const coderIdx = pipelineStages.indexOf('coder');
            if (coderIdx !== -1) {
              this.injectTestFailuresForCoder(attemptHistory);
              pipelineRun.stages['coder'] = { state: 'idle', retryCount: 0 };
              pipelineRun.stages['tester'] = { state: 'idle', retryCount: 0 };
              i = coderIdx - 1;
              continue;
            }
          }
        }
      }

      if (testerCoderFixCount > 0) {
        const finalVerdict = this.checkTesterVerdict() ? 'fail' : 'pass';
        logger.pipeline('info', 'tester-coder-loop:complete', { totalRounds: testerCoderFixCount, finalVerdict });
      }

      pipelineRun.completedAt = new Date().toISOString();
      this.savePipelineState(pipelineRun, validated.profile, testerCoderFixCount);

      ctx.logger.pipeline('info', 'pipeline:complete', { runId: resolvedRunId });
      ctx.eventBus.emit('pipeline:complete', resolvedRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.pipeline('error', 'pipeline:failed', { runId: resolvedRunId, error: message });
      ctx.eventBus.emit('pipeline:failed', resolvedRunId, message);
      // Save state even on failure so next resume picks up where we left off
      this.savePipelineState(pipelineRun, validated.profile, testerCoderFixCount ?? 0);
      throw err;
    } finally {
      await ctx.logger.close();
    }

    return pipelineRun;
  }

  /**
   * Persist pipeline state to disk so it can be resumed after crash.
   */
  private savePipelineState(run: PipelineRun, profile: string, fixLoopRound?: number): void {
    try {
      this.currentCtx!.store.write('pipeline-state.json', JSON.stringify({
        id: run.id,
        instruction: run.instruction,
        stages: run.stages,
        profile,
        autoApprove: run.autoApprove,
        createdAt: run.createdAt,
        fixLoopRound: fixLoopRound ?? 0,
      }, null, 2));
    } catch {
      // Non-fatal — resume is best-effort
    }
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
  ): Promise<void> {
    const ctx = this.currentCtx!;
    // Skip stages that are already done (resume scenario)
    if (run.stages[stage]?.state === 'done') {
      ctx.logger.pipeline('info', 'stage:skipped-resume', { stage });
      ctx.eventBus.emit('stage:skipped', stage, run.id);
      return;
    }

    const stageConfig = this.pipelineConfig.stages[stage]!;
    const maxRetries = stageConfig.retry_max;

    run.currentStage = stage;
    transitionStage(run, stage, 'running');
    ctx.logger.pipeline('info', 'stage:start', { stage });
    ctx.eventBus.emit('stage:start', stage, run.id);

    // Update retry context on provider (if wrapped with RetryingProvider)
    if (ctx.provider instanceof RetryingProvider) {
      ctx.provider.setContext(run.id, stage);
    }

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
      const context = buildContext(this.agentsConfig, task, ctx.store, ctx.logger, ctx.devMode);

      // Create and execute agent (with clarification handling)
      await this.executeAgent(run, stage, context);

      // Commit stage artifacts before gate check (so reviewers can see them)
      await this.commitStageArtifacts(stage, run.id);

      // Record commit SHA
      const metrics = this.stageMetrics.get(stage);
      if (metrics && this.publisher) {
        metrics.commitSha = this.publisher.getLastCommitSha() ?? undefined;
      }

      // Post preview comment for stages with visual outputs (before gate check)
      await this.postPreviewComment(stage, run.id);

      // Gate check
      if (shouldAutoApprove(run, stageConfig)) {
        transitionStage(run, stage, 'done');
      } else {
        // Manual gate
        transitionStage(run, stage, 'awaiting_human');
        ctx.eventBus.emit('stage:awaiting_human', stage, run.id);
        ctx.logger.pipeline('info', 'stage:awaiting_human', { stage });

        const gateResult = await this.handler.onManualGate(stage, run.id);

        if (gateResult.approved) {
          transitionStage(run, stage, 'approved');
          ctx.eventBus.emit('stage:approved', stage, run.id);
          transitionStage(run, stage, 'done');
        } else {
          // Track rejection in metrics
          const rejMetrics = this.stageMetrics.get(stage);
          if (rejMetrics) {
            rejMetrics.wasRejected = true;
            rejMetrics.rejectionFeedback = gateResult.feedback;
          }

          transitionStage(run, stage, 'rejected');
          ctx.eventBus.emit('stage:rejected', stage, run.id);
          ctx.logger.pipeline('info', 'stage:rejected', {
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

          // Re-run the stage after rejection (with depth guard)
          const stageStatus = run.stages[stage]!;
          if (stageStatus.retryCount >= maxRetries) {
            throw new Error(
              `Stage ${stage} rejected ${stageStatus.retryCount} times, exceeding max retries (${maxRetries})`
            );
          }
          stageStatus.retryCount++;
          transitionStage(run, stage, 'idle');
          return this.executeStage(run, stage);
        }
      }

      // Snapshot (non-blocking — must not fail the pipeline)
      try {
        const issueNumbers = Object.fromEntries(this.stageIssues);
        createSnapshot(stage, run.id, issueNumbers, ctx.store.getDir());
        ctx.eventBus.emit('snapshot:created', stage, run.id);
      } catch (snapErr) {
        ctx.logger.pipeline('warn', 'snapshot:failed', {
          stage,
          error: snapErr instanceof Error ? snapErr.message : String(snapErr),
        });
      }

      // Create informational Issue on stage complete (non-blocking)
      try {
        await this.createStageIssue(stage, run);
      } catch (issueErr) {
        ctx.logger.pipeline('warn', 'stage-issue:failed', {
          stage,
          error: issueErr instanceof Error ? issueErr.message : String(issueErr),
        });
      }

      ctx.logger.pipeline('info', 'stage:complete', { stage });
      ctx.eventBus.emit('stage:complete', stage, run.id);

      // Stage-level evolution removed — use `mosaicat evolve` instead
    } catch (err) {
      // ClarificationNeeded is handled inside executeAgent, not here
      const message = err instanceof Error ? err.message : String(err);
      const stageStatus = run.stages[stage]!;

      // Automatic retry (within retry_max)
      if (stageStatus.retryCount < maxRetries) {
        stageStatus.retryCount++;
        logRetry({
          timestamp: new Date().toISOString(),
          runId: run.id,
          stage,
          source: 'orchestrator',
          attempt: stageStatus.retryCount,
          errorCategory: classifyError(message),
          errorMessage: message,
          resolved: false,
        });
        transitionStage(run, stage, 'failed');
        transitionStage(run, stage, 'idle');
        ctx.logger.pipeline('warn', 'stage:retry', { stage, retry: stageStatus.retryCount });
        ctx.eventBus.emit('stage:retry', stage, run.id, stageStatus.retryCount);
        return this.executeStage(run, stage);
      }

      // Mark stage as failed
      transitionStage(run, stage, 'failed');
      ctx.eventBus.emit('stage:failed', stage, run.id, message);

      // Automatic retries exhausted — ask user what to do (if not auto-approve)
      if (!run.autoApprove) {
        const decision = await this.askUserOnStageFail(stage, stageStatus.retryCount, message);
        if (decision === 'retry') {
          stageStatus.retryCount = 0; // reset counter for a fresh round
          transitionStage(run, stage, 'idle');
          ctx.logger.pipeline('info', 'stage:manual-retry', { stage });
          ctx.eventBus.emit('stage:retry', stage, run.id, 0);
          return this.executeStage(run, stage);
        }
        if (decision === 'skip') {
          ctx.logger.pipeline('warn', 'stage:skipped', { stage, reason: 'user chose to skip after failure' });
          transitionStage(run, stage, 'skipped');
          return;
        }
        // decision === 'abort' → fall through to rollback + throw
      }

      // Rollback to previous stage
      const prev = getPreviousStage(run, stage);
      if (prev) {
        ctx.logger.pipeline('warn', 'stage:rollback', { from: stage, to: prev });
        ctx.eventBus.emit('stage:rollback', stage, prev, run.id);
        await this.closeRolledBackIssues(stage, run.id);
      }

      throw err;
    }
  }

  private async commitStageArtifacts(stage: StageName, runId: string): Promise<void> {
    const ctx = this.currentCtx!;
    if (!this.publisher) return;
    try {
      const agentConfig = this.agentsConfig.agents[stage]!;
      const files = (agentConfig.outputs ?? []).map((o: string) => `${ctx.store.getDir()}/${o}`);
      const issueNumber = this.stageIssues.get(`${runId}:${stage}`);
      await this.publisher.commitStage(stage, files, issueNumber, ctx.store.getDir());

      // Notify handler about PR (created lazily after first commit)
      const pr = this.publisher.getPR();
      if (pr && this.handler instanceof GitHubInteractionHandler) {
        this.handler.setPR(pr.number);
      }
    } catch (err) {
      ctx.logger.pipeline('warn', 'git-publisher:commit-failed', {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Post a PR comment with embedded screenshots and preview links for visual stages.
   * Called after commitStageArtifacts, before gate check, so reviewers can see the output.
   */
  private async postPreviewComment(stage: StageName, _runId: string): Promise<void> {
    const ctx = this.currentCtx!;
    if (!this.adapter || !this.publisher) return;
    const pr = this.publisher.getPR();
    if (!pr) return;

    // Only post for ui_designer (has screenshots + previews)
    if (stage !== 'ui_designer') return;

    const { owner, repo } = this.getRepoContext();
    const branch = this.publisher.getBranch() ?? '';
    if (!owner || !repo || !branch) return;

    try {
      const lines: string[] = ['## 🎨 UIDesigner — Component Preview', ''];

      // Screenshots (mapped to docs/mosaicat/screenshots/ in repo)
      const screenshotsDir = `${ctx.store.getDir()}/screenshots`;
      const screenshots = this.safeReadDir(screenshotsDir).filter(f => f.endsWith('.png'));
      if (screenshots.length > 0) {
        lines.push('### Screenshots');
        lines.push('');
        for (const file of screenshots) {
          const name = file.replace('.png', '');
          const imgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/docs/mosaicat/screenshots/${file}`;
          lines.push(`<details><summary>${name}</summary>`);
          lines.push('');
          lines.push(`![${name}](${imgUrl})`);
          lines.push('');
          lines.push('</details>');
          lines.push('');
        }
      }

      // Interactive preview links (mapped to docs/mosaicat/previews/ in repo)
      const previewsDir = `${ctx.store.getDir()}/previews`;
      const previews = this.safeReadDir(previewsDir).filter(f => f.endsWith('.html'));
      if (previews.length > 0) {
        lines.push('### Interactive Previews');
        lines.push('');
        for (const file of previews) {
          const name = file.replace('.html', '');
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/docs/mosaicat/previews/${file}`;
          const previewUrl = `https://htmlpreview.github.io/?${rawUrl}`;
          lines.push(`- [${name}](${previewUrl})`);
        }
        lines.push('');
      }

      // Gallery link (mapped to docs/mosaicat/gallery.html in repo)
      if (fs.existsSync(`${ctx.store.getDir()}/gallery.html`)) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/docs/mosaicat/gallery.html`;
        const galleryUrl = `https://htmlpreview.github.io/?${rawUrl}`;
        lines.push(`### [View Gallery](${galleryUrl})`);
        lines.push('');
      }

      if (screenshots.length > 0 || previews.length > 0) {
        await this.adapter.addComment(pr.number, lines.join('\n'));
      }
    } catch (err) {
      ctx.logger.pipeline('warn', 'preview-comment:failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getRepoContext(): { owner: string; repo: string } {
    if (!this.adapter) return { owner: '', repo: '' };
    return { owner: this.adapter.getOwner(), repo: this.adapter.getRepo() };
  }

  private safeReadDir(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }

  /**
   * Ask user what to do when a stage has exhausted automatic retries.
   * Returns 'retry' | 'skip' | 'abort'.
   */
  private async askUserOnStageFail(
    stage: StageName,
    attempts: number,
    error: string,
  ): Promise<'retry' | 'skip' | 'abort'> {
    const agentName = AGENT_DESC[stage];
    const errorPreview = error.slice(0, 500);

    const answer = await this.handler.onClarification(
      stage,
      `${agentName}（${stage}）在自动重试 ${attempts} 次后仍然失败。\n\n错误信息:\n${errorPreview}\n\n请选择操作:`,
      '',
      [
        { label: 'Retry', description: '重置重试计数，重新执行该阶段' },
        { label: 'Skip', description: '跳过该阶段，继续后续流程' },
        { label: 'Abort', description: '终止 Pipeline' },
      ],
      false,
    );

    const lower = answer.toLowerCase();
    if (lower.includes('retry') || lower.includes('重试')) return 'retry';
    if (lower.includes('skip') || lower.includes('跳过')) return 'skip';
    return 'abort';
  }

  private async executeAgent(
    run: PipelineRun,
    stage: StageName,
    context: AgentContext
  ): Promise<void> {
    const ctx = this.currentCtx!;
    const agentConfig = this.agentsConfig.agents[stage];
    // Pass handler to agents that support interactive retry (Coder).
    // In auto-approve mode, pass undefined so they auto-skip after retries.
    const agentHandler = run.autoApprove ? undefined : this.handler;
    const agent = createAgent(stage, ctx, agentConfig?.autonomy, agentHandler);

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
      ctx.logger.pipeline('info', 'stage:clarification', { stage, question: err.question });

      let answer: string;
      if (run.autoApprove) {
        // Auto-select: last option (convention: default/fallback) or generic default
        const lastOption = err.options?.[err.options.length - 1];
        answer = lastOption?.label ?? 'default';
        ctx.logger.pipeline('info', 'stage:clarification-auto', {
          stage,
          answer,
          reason: 'auto-approve mode',
        });
        ctx.eventBus.emit('clarification:answered', stage, err.question, answer, 'auto-approve');
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
      const retryAgent = createAgent(stage, ctx, agentConfig?.autonomy, agentHandler);
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
    const manifestSummary = manifestName ? extractManifestSummary(this.currentCtx!.store, manifestName) : [];

    // GitHub context for links
    const { owner, repo } = this.getRepoContext();
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
      artifactsDir: this.currentCtx!.store.getDir(),
    };

    const issue = await this.adapter.createIssue({
      title: buildStageIssueTitle(params),
      body: buildIssueBody(params),
      labels: [`agent:${stage}`, 'status:completed'],
    });

    this.stageIssues.set(`${run.id}:${stage}`, issue.number);
    this.currentCtx!.eventBus.emit('issue:created', issue.number, stage, run.id);
  }

  private collectScreenshots(): string[] {
    const dir = `${this.currentCtx!.store.getDir()}/screenshots`;
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
    this.currentCtx!.eventBus.emit('issue:closed', issueNumber, stage, runId);
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
  ): Promise<void> {
    const ctx = this.currentCtx!;
    // Skip if intent-brief.json already exists (resume / retry scenario)
    if (ctx.store.exists('intent-brief.json')) {
      ctx.logger.pipeline('info', 'intent-consultant:skipped', { reason: 'brief already exists' });
      return;
    }

    ctx.logger.pipeline('info', 'intent-consultant:start', { runId: run.id });
    ctx.eventBus.emit('stage:start', 'intent_consultant', run.id);

    // Intent Consultant always uses CLI interaction (multi-turn dialogue needs terminal,
    // not GitHub Issue polling). GitHub mode kicks in after the brief is produced.
    const cliHandler = new CLIInteractionHandler();

    // Use 'researcher' as placeholder StageName — IntentConsultant is not a pipeline stage yet
    const placeholderStage = 'researcher' as StageName;
    const agent = new IntentConsultantAgent(
      placeholderStage,
      ctx,
      cliHandler,
    );

    const context: AgentContext = {
      systemPrompt: '',
      task: { runId: run.id, stage: placeholderStage, instruction: run.instruction },
      inputArtifacts: new Map([['user_instruction', run.instruction]]),
    };

    await agent.execute(context);
    ctx.logger.pipeline('info', 'intent-consultant:complete', { runId: run.id });
  }

  private async runStageEvolution(
    runId: string,
    stage: StageName,
  ): Promise<void> {
    const ctx = this.currentCtx!;
    try {
      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');

      const engine = new EvolutionEngine(ctx.provider, ctx.logger);
      const proposals = await engine.analyzeStage(runId, stage);

      if (proposals.length > 0) {
        const handler = new ProposalHandler(this.handler, ctx.provider, ctx.logger, ctx.eventBus);
        await handler.processProposals(proposals);
      }
    } catch (err) {
      ctx.logger.pipeline('error', 'evolution:stage-error', {
        stage,
        error: err instanceof Error ? err.message : String(err),
      });
      // Stage evolution errors don't fail the pipeline
    }
  }

  private async runEvolution(
    runId: string,
  ): Promise<void> {
    const ctx = this.currentCtx!;
    try {
      ctx.eventBus.emit('evolution:analyzing', runId);
      ctx.logger.pipeline('info', 'evolution:start', { runId });

      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');

      const engine = new EvolutionEngine(ctx.provider, ctx.logger);
      const proposals = await engine.analyze(runId);

      if (proposals.length > 0) {
        const handler = new ProposalHandler(this.handler, ctx.provider, ctx.logger, ctx.eventBus);
        await handler.processProposals(proposals);
      }

      ctx.eventBus.emit('evolution:complete', runId, proposals.length);
      ctx.logger.pipeline('info', 'evolution:complete', { runId, proposalCount: proposals.length });
    } catch (err) {
      ctx.logger.pipeline('error', 'evolution:error', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Evolution errors don't fail the pipeline
    }
  }

  /**
   * Check if tester verdict is 'fail' — triggers Coder fix loop.
   */
  private checkTesterVerdict(): boolean {
    const ctx = this.currentCtx!;
    try {
      if (!ctx.store.exists('test-report.manifest.json')) return false;
      const manifest = JSON.parse(ctx.store.read('test-report.manifest.json'));
      if (manifest.verdict === 'fail') {
        ctx.logger.pipeline('info', 'tester-coder-loop:verdict-fail', {
          failed: manifest.failed,
          total: manifest.total,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Write test failures to a well-known artifact location so Coder can read them.
   * The Coder agent checks for 'test_failures' in inputArtifacts.
   */
  private injectTestFailuresForCoder(
    attemptHistory?: Array<{ round: number; failures: string; approach: string }>,
  ): void {
    const ctx = this.currentCtx!;
    try {
      if (!ctx.store.exists('test-report.manifest.json')) return;
      const manifest = ctx.store.read('test-report.manifest.json');

      // Build cumulative context with attempt history
      let failureContext = manifest;
      if (attemptHistory && attemptHistory.length > 0) {
        const historySection = attemptHistory.map(h =>
          `\n--- Round ${h.round} (${h.approach}) ---\n${h.failures}`
        ).join('\n');
        failureContext = `${manifest}\n\n## Previous Fix Attempts\n${historySection}`;
      }

      // Add test_failures to coder's inputs so context-manager loads it
      const agentConfig = this.agentsConfig.agents['coder'];
      if (agentConfig && !agentConfig.inputs.includes('test_failures')) {
        agentConfig.inputs.push('test_failures');
      }
      // Write test failures as an artifact the coder can read
      ctx.store.write('test_failures', failureContext);
    } catch {
      // Non-fatal
    }
  }

  getStageIssues(): Map<string, number> {
    return new Map(this.stageIssues);
  }

}
