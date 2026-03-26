import type { StageName } from './types.js';
import type { EventBus } from './event-bus.js';
import { CLIArtifactPresenter } from './artifact-presenter.js';

const AGENT_LABELS: Record<StageName, string> = {
  intent_consultant: 'IntentConsultant',
  researcher: 'Researcher',
  product_owner: 'ProductOwner',
  ux_designer: 'UXDesigner',
  api_designer: 'APIDesigner',
  ui_designer: 'UIDesigner',
  tech_lead: 'TechLead',
  coder: 'Coder',
  reviewer: 'Reviewer',
  validator: 'Validator',
  qa_lead: 'QALead',
  tester: 'Tester',
  security_auditor: 'SecurityAuditor',
};

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

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m${sec}s`;
}

export function attachCLIProgress(eventBusInstance: EventBus): () => void {
  const stageTimers = new Map<StageName, number>();
  const pipelineStart = Date.now();
  let activeStages: readonly StageName[] = [];

  const handlers: Array<[string, (...args: any[]) => void]> = [];

  function on<E extends keyof import('./event-bus.js').PipelineEvents>(
    event: E,
    handler: import('./event-bus.js').PipelineEvents[E]
  ) {
    eventBusInstance.on(event, handler);
    handlers.push([event, handler as any]);
  }

  // ── Pipeline ──

  on('pipeline:start', (runId, stages, provider) => {
    if (stages) activeStages = stages;
    process.stdout.write(`\n${BOLD}${CYAN}━━━ Mosaicat Pipeline ━━━${RESET}\n`);
    process.stdout.write(`${DIM}Run: ${runId}${RESET}\n`);
    if (provider) process.stdout.write(`${DIM}LLM: ${provider}${RESET}\n`);
    process.stdout.write(`${DIM}Stages: ${activeStages.map((s, i) => `${i + 1}.${AGENT_LABELS[s]}`).join(' → ')}${RESET}\n\n`);
  });

  on('pipeline:complete', (_runId) => {
    const elapsed = formatDuration(Date.now() - pipelineStart);
    process.stdout.write(`\n${BOLD}${GREEN}✓ Pipeline complete${RESET} ${DIM}(${elapsed})${RESET}\n\n`);
  });

  on('pipeline:failed', (_runId, error) => {
    const elapsed = formatDuration(Date.now() - pipelineStart);
    process.stdout.write(`\n${BOLD}${RED}✗ Pipeline failed${RESET} ${DIM}(${elapsed})${RESET}\n`);
    process.stdout.write(`  ${RED}${error}${RESET}\n\n`);
  });

  // ── Stage ──

  on('stage:start', (stage, _runId) => {
    stageTimers.set(stage, Date.now());
    const idx = activeStages.indexOf(stage) + 1;
    const label = AGENT_LABELS[stage];
    const desc = AGENT_DESC[stage];
    const total = activeStages.length;
    process.stdout.write(`${BOLD}[${idx}/${total}] ${label}${RESET} ${DIM}— ${desc}${RESET}\n`);
  });

  on('stage:complete', (stage, _runId) => {
    const start = stageTimers.get(stage);
    const elapsed = start ? formatDuration(Date.now() - start) : '?';
    process.stdout.write(`  ${GREEN}✓ done${RESET} ${DIM}(${elapsed})${RESET}\n\n`);
  });

  on('stage:skipped', (stage, _runId) => {
    const idx = activeStages.indexOf(stage) + 1;
    const label = AGENT_LABELS[stage] ?? stage;
    const total = activeStages.length;
    process.stdout.write(`${DIM}[${idx}/${total}] ${label} — ✓ cached${RESET}\n`);
  });

  on('stage:failed', (stage, _runId, error) => {
    process.stdout.write(`  ${RED}✗ failed: ${error}${RESET}\n`);
  });

  on('stage:retry', (stage, _runId, attempt) => {
    process.stdout.write(`  ${YELLOW}↻ retry #${attempt}${RESET}\n`);
  });

  on('stage:rollback', (from, to, _runId) => {
    process.stdout.write(`  ${RED}↩ rollback: ${AGENT_LABELS[from]} → ${AGENT_LABELS[to]}${RESET}\n`);
  });

  on('stage:awaiting_human', (stage, _runId) => {
    process.stdout.write(`  ${YELLOW}⏳ waiting for approval...${RESET}\n`);
    process.stdout.write(`  ${DIM}   Review the artifacts above, then answer the prompt below.${RESET}\n`);
  });

  on('stage:approved', (_stage, _runId) => {
    process.stdout.write(`  ${GREEN}✓ approved${RESET}\n`);
  });

  on('stage:rejected', (_stage, _runId) => {
    process.stdout.write(`  ${RED}✗ rejected — re-running${RESET}\n`);
  });

  // ── Agent ──

  on('agent:context', (stage, inputs) => {
    const inputList = inputs.length > 0 ? inputs.join(', ') : '(none)';
    process.stdout.write(`  ${DIM}inputs: ${inputList}${RESET}\n`);
  });

  on('agent:thinking', (stage, promptLength) => {
    process.stdout.write(`  ${MAGENTA}◆ thinking...${RESET} ${DIM}(prompt: ${formatBytes(promptLength)})${RESET}\n`);
  });

  on('agent:response', (stage, responseLength) => {
    process.stdout.write(`  ${BLUE}◇ response received${RESET} ${DIM}(${formatBytes(responseLength)})${RESET}\n`);
  });

  on('agent:progress', (_stage, message) => {
    process.stdout.write(`  ${DIM}${message}${RESET}\n`);
  });

  on('agent:clarification', (stage, question) => {
    process.stdout.write(`  ${YELLOW}? clarification needed:${RESET} ${question}\n`);
  });

  on('clarification:answered', (_stage, _question, answer, source) => {
    const sourceLabel = source === 'github' ? 'GitHub PR' : source;
    process.stdout.write(`  ${CYAN}↳ 通过 ${sourceLabel} 回复: "${answer}"${RESET}\n`);
  });

  // ── Agent Summary ──

  on('agent:summary', (_stage, summary) => {
    // Display multi-line summaries with indentation
    for (const line of summary.split('\n')) {
      process.stdout.write(`  ${DIM}→ ${line}${RESET}\n`);
    }
  });

  on('coder:fix-round', (round, totalTests, passedTests, approach) => {
    const failed = totalTests - passedTests;
    process.stdout.write(`  ${YELLOW}↻ fix round ${round}:${RESET} ${passedTests}/${totalTests} passed, ${failed} failed — ${approach}\n`);
  });

  // ── Artifacts ──

  const presenter = new CLIArtifactPresenter();

  on('artifact:written', (stage, name, size) => {
    process.stdout.write(`  ${CYAN}→${RESET} ${presenter.formatLink(name, size)}\n`);
  });

  on('manifest:written', (stage, name) => {
    process.stdout.write(`  ${CYAN}→${RESET} ${name} ${DIM}(manifest)${RESET}\n`);
  });

  on('snapshot:created', (stage, _runId) => {
    process.stdout.write(`  ${DIM}📸 snapshot saved${RESET}\n`);
  });

  // ── Issues ──

  on('issue:created', (issueNumber, stage, _runId) => {
    process.stdout.write(`  ${DIM}📋 issue #${issueNumber} created${RESET}\n`);
  });

  // ── Evolution ──

  on('evolution:analyzing', (_runId) => {
    process.stdout.write(`\n${BOLD}${MAGENTA}◆ evolution: analyzing pipeline results...${RESET}\n`);
  });

  on('evolution:proposed', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    process.stdout.write(`  ${YELLOW}→ proposal: [${label}] ${proposalId}${RESET}\n`);
  });

  on('evolution:approved', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    process.stdout.write(`  ${GREEN}✓ approved: [${label}] ${proposalId}${RESET}\n`);
  });

  on('evolution:rejected', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    process.stdout.write(`  ${RED}✗ rejected: [${label}] ${proposalId}${RESET}\n`);
  });

  on('evolution:proposals', (proposals) => {
    for (const p of proposals) {
      process.stdout.write(`  ${YELLOW}→ ${p.type}: ${p.reason}${RESET} ${DIM}(${p.id})${RESET}\n`);
    }
  });

  on('evolution:complete', (_runId, proposalCount) => {
    process.stdout.write(`  ${DIM}evolution complete — ${proposalCount} proposal(s) processed${RESET}\n\n`);
  });

  // Return cleanup function
  return () => {
    for (const [event, handler] of handlers) {
      eventBusInstance.off(event as any, handler);
    }
  };
}
