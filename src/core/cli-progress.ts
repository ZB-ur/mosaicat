import type { StageName } from './types.js';
import { STAGE_ORDER } from './types.js';
import { eventBus } from './event-bus.js';
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

function stageIndex(stage: StageName): number {
  return STAGE_ORDER.indexOf(stage) + 1;
}

export function attachCLIProgress(): () => void {
  const stageTimers = new Map<StageName, number>();
  const pipelineStart = Date.now();

  const handlers: Array<[string, (...args: any[]) => void]> = [];

  function on<E extends keyof import('./event-bus.js').PipelineEvents>(
    event: E,
    handler: import('./event-bus.js').PipelineEvents[E]
  ) {
    eventBus.on(event, handler);
    handlers.push([event, handler as any]);
  }

  // ── Pipeline ──

  on('pipeline:start', (runId) => {
    console.log(`\n${BOLD}${CYAN}━━━ Mosaicat Pipeline ━━━${RESET}`);
    console.log(`${DIM}Run: ${runId}${RESET}`);
    console.log(`${DIM}Stages: ${STAGE_ORDER.map((s, i) => `${i + 1}.${AGENT_LABELS[s]}`).join(' → ')}${RESET}\n`);
  });

  on('pipeline:complete', (_runId) => {
    const elapsed = formatDuration(Date.now() - pipelineStart);
    console.log(`\n${BOLD}${GREEN}✓ Pipeline complete${RESET} ${DIM}(${elapsed})${RESET}\n`);
  });

  on('pipeline:failed', (_runId, error) => {
    const elapsed = formatDuration(Date.now() - pipelineStart);
    console.log(`\n${BOLD}${RED}✗ Pipeline failed${RESET} ${DIM}(${elapsed})${RESET}`);
    console.log(`  ${RED}${error}${RESET}\n`);
  });

  // ── Stage ──

  on('stage:start', (stage, _runId) => {
    stageTimers.set(stage, Date.now());
    const idx = stageIndex(stage);
    const label = AGENT_LABELS[stage];
    const desc = AGENT_DESC[stage];
    console.log(`${BOLD}[${idx}/6] ${label}${RESET} ${DIM}— ${desc}${RESET}`);
  });

  on('stage:complete', (stage, _runId) => {
    const start = stageTimers.get(stage);
    const elapsed = start ? formatDuration(Date.now() - start) : '?';
    console.log(`  ${GREEN}✓ done${RESET} ${DIM}(${elapsed})${RESET}\n`);
  });

  on('stage:failed', (stage, _runId, error) => {
    console.log(`  ${RED}✗ failed: ${error}${RESET}`);
  });

  on('stage:retry', (stage, _runId, attempt) => {
    console.log(`  ${YELLOW}↻ retry #${attempt}${RESET}`);
  });

  on('stage:rollback', (from, to, _runId) => {
    console.log(`  ${RED}↩ rollback: ${AGENT_LABELS[from]} → ${AGENT_LABELS[to]}${RESET}`);
  });

  on('stage:awaiting_human', (stage, _runId) => {
    console.log(`  ${YELLOW}⏳ waiting for approval...${RESET}`);
    console.log(`  ${DIM}   Review the artifacts above, then answer the prompt below.${RESET}`);
  });

  on('stage:approved', (_stage, _runId) => {
    console.log(`  ${GREEN}✓ approved${RESET}`);
  });

  on('stage:rejected', (_stage, _runId) => {
    console.log(`  ${RED}✗ rejected — re-running${RESET}`);
  });

  // ── Agent ──

  on('agent:context', (stage, inputs) => {
    const inputList = inputs.length > 0 ? inputs.join(', ') : '(none)';
    console.log(`  ${DIM}inputs: ${inputList}${RESET}`);
  });

  on('agent:thinking', (stage, promptLength) => {
    console.log(`  ${MAGENTA}◆ thinking...${RESET} ${DIM}(prompt: ${formatBytes(promptLength)})${RESET}`);
  });

  on('agent:response', (stage, responseLength) => {
    console.log(`  ${BLUE}◇ response received${RESET} ${DIM}(${formatBytes(responseLength)})${RESET}`);
  });

  on('agent:clarification', (stage, question) => {
    console.log(`  ${YELLOW}? clarification needed:${RESET} ${question}`);
  });

  // ── Artifacts ──

  const presenter = new CLIArtifactPresenter();

  on('artifact:written', (stage, name, size) => {
    console.log(`  ${CYAN}→${RESET} ${presenter.formatLink(name, size)}`);
  });

  on('manifest:written', (stage, name) => {
    console.log(`  ${CYAN}→${RESET} ${name} ${DIM}(manifest)${RESET}`);
  });

  on('snapshot:created', (stage, _runId) => {
    console.log(`  ${DIM}📸 snapshot saved${RESET}`);
  });

  // ── Issues ──

  on('issue:created', (issueNumber, stage, _runId) => {
    console.log(`  ${DIM}📋 issue #${issueNumber} created${RESET}`);
  });

  // ── Evolution ──

  on('evolution:analyzing', (_runId) => {
    console.log(`\n${BOLD}${MAGENTA}◆ evolution: analyzing pipeline results...${RESET}`);
  });

  on('evolution:proposed', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    console.log(`  ${YELLOW}→ proposal: [${label}] ${proposalId}${RESET}`);
  });

  on('evolution:approved', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    console.log(`  ${GREEN}✓ approved: [${label}] ${proposalId}${RESET}`);
  });

  on('evolution:rejected', (proposalId, stage) => {
    const label = AGENT_LABELS[stage];
    console.log(`  ${RED}✗ rejected: [${label}] ${proposalId}${RESET}`);
  });

  on('evolution:complete', (_runId, proposalCount) => {
    console.log(`  ${DIM}evolution complete — ${proposalCount} proposal(s) processed${RESET}\n`);
  });

  // Return cleanup function
  return () => {
    for (const [event, handler] of handlers) {
      eventBus.off(event as any, handler);
    }
  };
}
