import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig, AgentsConfig, StageName, PipelineRun, AgentContext, PipelineProfile } from './types.js';
import { createPipelineRun } from './pipeline.js';
import { createProvider } from './provider-factory.js';
import { EventBus } from './event-bus.js';
import { Logger } from './logger.js';
import type { RunContext } from './run-context.js';
import { createRunContext } from './run-context.js';
import { ArtifactStore } from './artifact-store.js';
import type { InteractionHandler } from './interaction-handler.js';
import { CLIInteractionHandler } from './interaction-handler.js';
import type { GitPlatformAdapter } from '../adapters/types.js';
import { GitPublisher } from './git-publisher.js';
import { generatePRBody } from './pr-body-generator.js';
import { IntentConsultantAgent } from '../agents/intent-consultant.js';
import { loadUserLLMConfig } from './llm-config-store.js';
import { loadResumeState, validateResumeState, findResumableRun, resetFromStage } from './resume.js';
import { StageExecutor } from './stage-executor.js';
import { FixLoopRunner } from './fix-loop-runner.js';
import { PipelineLoop } from './pipeline-loop.js';
import type { PipelineLoopCallbacks } from './pipeline-loop.js';
import { OrchestratorGitOps } from './orchestrator-git-ops.js';

/** Thin facade: creates RunContext and delegates pipeline execution to PipelineLoop. */
export class Orchestrator {
  private pipelineConfig: PipelineConfig;
  private agentsConfig: AgentsConfig;
  private handler: InteractionHandler;
  private adapter?: GitPlatformAdapter;
  private publisher?: GitPublisher;
  private gitOps?: OrchestratorGitOps;
  private evolutionEnabled: boolean;
  private devMode: boolean;
  private signal?: AbortSignal;
  private currentCtx?: RunContext;
  readonly eventBus: EventBus;

  constructor(handler?: InteractionHandler, adapter?: GitPlatformAdapter, options?: { enableEvolution?: boolean; devMode?: boolean; signal?: AbortSignal }) {
    this.pipelineConfig = yaml.load(fs.readFileSync('config/pipeline.yaml', 'utf-8')) as PipelineConfig;
    this.agentsConfig = yaml.load(fs.readFileSync('config/agents.yaml', 'utf-8')) as AgentsConfig;
    this.handler = handler ?? new CLIInteractionHandler();
    this.adapter = adapter;
    this.evolutionEnabled = options?.enableEvolution ?? false;
    this.devMode = options?.devMode ?? false;
    this.signal = options?.signal;
    this.eventBus = new EventBus();
  }

  async run(instruction: string, autoApprove = false, profile?: PipelineProfile): Promise<PipelineRun> {
    const runId = `run-${Date.now()}`;
    const stageList = this.resolveStageList(profile);
    const pipelineRun = createPipelineRun(runId, instruction, autoApprove, stageList);
    const ctx = this.initRunContext(runId);
    ctx.logger.pipeline('info', 'pipeline:start', { runId, instruction, profile: profile ?? 'default', artifactsDir: ctx.store.getDir(), provider: this.resolveProviderName() });
    await this.initPublisher(runId, instruction, ctx);
    try {
      await this.runIntentConsultant(pipelineRun);
      await this.executePipeline(pipelineRun, stageList.filter(s => s !== 'intent_consultant'), profile ?? 'full');
      await this.postRun(runId, instruction, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.pipeline('error', 'pipeline:failed', { runId, error: msg });
      ctx.eventBus.emit('pipeline:failed', runId, msg);
      throw err;
    } finally { await ctx.logger.close(); }
    return pipelineRun;
  }

  async resumeRun(runId?: string, fromStage?: string): Promise<PipelineRun> {
    const rid = runId ?? findResumableRun();
    if (!rid) throw new Error('No resumable run found. Specify --run <runId> or ensure a pipeline-state.json exists.');
    const state = loadResumeState(rid);
    if (fromStage) {
      resetFromStage(state, fromStage as StageName, this.resolveStageList(state.profile as PipelineProfile));
      fs.writeFileSync(`.mosaic/artifacts/${rid}/pipeline-state.json`, JSON.stringify(state, null, 2));
    }
    const validated = validateResumeState(state, this.agentsConfig);
    const ctx = this.initRunContext(rid);
    ctx.logger.pipeline('info', 'pipeline:resume', { runId: rid, profile: validated.profile, provider: this.resolveProviderName(), doneStages: Object.entries(validated.stages).filter(([, s]) => s?.state === 'done').map(([n]) => n) });
    const stageList = this.resolveStageList(validated.profile as PipelineProfile);
    const pipelineRun = createPipelineRun(rid, validated.instruction, validated.autoApprove, stageList);
    for (const [stage, status] of Object.entries(validated.stages)) {
      if (status?.state === 'done') pipelineRun.stages[stage as StageName] = status;
    }
    try {
      await this.runIntentConsultant(pipelineRun);
      await this.executePipeline(pipelineRun, stageList.filter(s => s !== 'intent_consultant'), validated.profile);
      pipelineRun.completedAt = new Date().toISOString();
      this.savePipelineState(pipelineRun, validated.profile);
      ctx.logger.pipeline('info', 'pipeline:complete', { runId: rid });
      ctx.eventBus.emit('pipeline:complete', rid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.pipeline('error', 'pipeline:failed', { runId: rid, error: msg });
      ctx.eventBus.emit('pipeline:failed', rid, msg);
      this.savePipelineState(pipelineRun, validated.profile);
      throw err;
    } finally { await ctx.logger.close(); }
    return pipelineRun;
  }

  getStageIssues(): Map<string, number> { return this.gitOps?.getStageIssues() ?? new Map(); }

  private initRunContext(runId: string): RunContext {
    const store = new ArtifactStore('.mosaic/artifacts', runId);
    const ctx = createRunContext({ store, logger: new Logger(runId), provider: createProvider(this.pipelineConfig), eventBus: this.eventBus, config: this.pipelineConfig, signal: this.signal, devMode: this.devMode });
    this.currentCtx = ctx;
    this.gitOps = new OrchestratorGitOps(ctx, this.agentsConfig, this.handler, this.adapter, this.publisher);
    return ctx;
  }

  private resolveProviderName(): string {
    return loadUserLLMConfig()?.provider ?? this.pipelineConfig.llm?.default ?? 'claude-cli';
  }

  private async initPublisher(runId: string, instruction: string, ctx: RunContext): Promise<void> {
    if (!this.adapter) return;
    this.publisher = new GitPublisher(this.adapter);
    try { await this.publisher.init(runId, instruction.slice(0, 80)); }
    catch (err) { ctx.logger.pipeline('warn', 'git-publisher:init-failed', { error: err instanceof Error ? err.message : String(err) }); this.publisher = undefined; }
    this.gitOps?.setPublisher(this.publisher);
  }

  private async executePipeline(run: PipelineRun, stages: readonly StageName[], profile: string): Promise<void> {
    const ctx = this.currentCtx!;
    const executor = new StageExecutor(ctx, this.agentsConfig, this.handler);
    const fixRunner = new FixLoopRunner(executor, ctx);
    await new PipelineLoop(executor, fixRunner, ctx, {
      savePipelineState: (r, fixRound) => this.savePipelineState(r, profile, fixRound),
      onStageExhausted: (stage, retryCount, error) => this.gitOps!.askUserOnStageFail(stage, retryCount, error),
      onStageComplete: (stage, r) => this.gitOps!.onStageComplete(stage, r),
    }).run(run, stages);
  }

  private async postRun(runId: string, instruction: string, ctx: RunContext): Promise<void> {
    if (this.evolutionEnabled) await this.runEvolution(runId);
    await this.gitOps!.createSummaryIssue(runId, instruction);
    if (!this.publisher) return;
    try {
      const { owner, repo } = this.gitOps!.getRepoContext();
      const branch = this.publisher.getBranch() ?? '';
      const body = (owner && repo && branch) ? generatePRBody({ runId, owner, repo, branch, artifactsDir: ctx.store.getDir() }) : `## Pipeline Complete\n\nRun: ${runId}`;
      await this.publisher.publish(body);
    } catch (err) { ctx.logger.pipeline('warn', 'git-publisher:publish-failed', { error: err instanceof Error ? err.message : String(err) }); }
  }

  private savePipelineState(run: PipelineRun, profile: string, fixLoopRound?: number): void {
    try {
      this.currentCtx!.store.write('pipeline-state.json', JSON.stringify({ id: run.id, instruction: run.instruction, stages: run.stages, profile, autoApprove: run.autoApprove, createdAt: run.createdAt, fixLoopRound: fixLoopRound ?? 0 }, null, 2));
    } catch { /* Non-fatal */ }
  }

  private resolveStageList(profile?: PipelineProfile): readonly StageName[] {
    const p = this.pipelineConfig.profiles, rp = profile ?? 'full';
    if (!p?.[rp]) throw new Error(`Unknown pipeline profile: ${rp}. Available: ${p ? Object.keys(p).join(', ') : 'none'}`);
    return p[rp];
  }

  private async runIntentConsultant(run: PipelineRun): Promise<void> {
    const ctx = this.currentCtx!;
    if (ctx.store.exists('intent-brief.json')) { ctx.logger.pipeline('info', 'intent-consultant:skipped', { reason: 'brief already exists' }); return; }
    ctx.logger.pipeline('info', 'intent-consultant:start', { runId: run.id });
    ctx.eventBus.emit('stage:start', 'intent_consultant', run.id);
    const stage = 'researcher' as StageName;
    await new IntentConsultantAgent(stage, ctx, new CLIInteractionHandler()).execute({ systemPrompt: '', task: { runId: run.id, stage, instruction: run.instruction }, inputArtifacts: new Map([['user_instruction', run.instruction]]) });
    ctx.logger.pipeline('info', 'intent-consultant:complete', { runId: run.id });
  }

  private async runEvolution(runId: string): Promise<void> {
    const ctx = this.currentCtx!;
    try {
      ctx.eventBus.emit('evolution:analyzing', runId);
      const { EvolutionEngine } = await import('../evolution/engine.js');
      const { ProposalHandler } = await import('../evolution/proposal-handler.js');
      const proposals = await new EvolutionEngine(ctx.provider, ctx.logger).analyze(runId);
      if (proposals.length > 0) await new ProposalHandler(this.handler, ctx.provider, ctx.logger, ctx.eventBus).processProposals(proposals);
      ctx.eventBus.emit('evolution:complete', runId, proposals.length);
    } catch (err) { ctx.logger.pipeline('error', 'evolution:error', { error: err instanceof Error ? err.message : String(err) }); }
  }
}
