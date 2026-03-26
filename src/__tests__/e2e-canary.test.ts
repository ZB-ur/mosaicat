/**
 * Canary E2E Integration Test — Full 13-Stage Pipeline
 *
 * Exercises the entire pipeline with all real modules except LLM (deterministic stub).
 * If this test breaks during a rewrite, something fundamental is wrong.
 *
 * Coverage:
 * - All 13 stages: intent_consultant, researcher, product_owner, ux_designer,
 *   api_designer, ui_designer, tech_lead, qa_lead, coder, tester,
 *   security_auditor, reviewer, validator
 * - Artifact verification: every stage's output files exist on disk
 * - Manifest validation: all manifest JSON files are valid and non-empty
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';

// ---------------------------------------------------------------------------
// CanaryStubProvider — deterministic responses for all 13 stages
// ---------------------------------------------------------------------------
class CanaryStubProvider implements LLMProvider {
  callCount = 0;
  private uiBuilderCallCount = 0;
  private coderPhase: 'planner' | 'skeleton' | 'builder' | 'fix' = 'planner';

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    const sys = _options?.systemPrompt ?? '';
    // Use lowercase for case-insensitive matching against prompt file headings
    const sysLower = sys.toLowerCase();
    const promptLower = _prompt.toLowerCase();

    // --- Intent Consultant ---
    if (sysLower.includes('intent consultant') || promptLower.includes('## user instruction')) {
      return {
        content: JSON.stringify({
          ready_to_converge: true,
          intent_brief: {
            problem: 'Todo app for canary test',
            target_users: 'Developers',
            core_scenarios: ['Manage tasks'],
            mvp_boundary: 'Basic CRUD',
            constraints: [],
            domain_specifics: [],
            recommended_profile: 'full',
            profile_reason: 'Full pipeline canary test',
          },
        }),
      };
    }

    this.callCount++;

    // --- UIDesigner planner (prompt: "# UIPlanner" or "planning phase of the UI designer") ---
    if (sysLower.includes('uiplanner') || sysLower.includes('planning phase of the ui designer')) {
      return { content: this.uiPlannerResponse() };
    }

    // --- UIDesigner builder (prompt: "# UIBuilder" or "builder phase of the UI designer") ---
    if (sysLower.includes('uibuilder') || sysLower.includes('builder phase of the ui designer')) {
      return { content: this.uiBuilderResponse() };
    }

    // NOTE: Coder, QALead, Tester, SecurityAuditor are handled by stub agents
    // in the agent-factory mock, so their LLM calls never reach this provider.

    // --- Dispatch by system prompt heading (most reliable) ---
    // Each agent prompt file starts with "# {AgentName} Agent"
    // We match against these unique identifiers first.
    const stageMap: Array<[string, () => string]> = [
      ['securityauditor agent', () => this.securityAuditorResponse()],
      ['tester agent', () => this.testerResponse()],
      ['researcher agent', () => this.researcherResponse()],
      ['productowner agent', () => this.productOwnerResponse()],
      ['uxdesigner agent', () => this.uxDesignerResponse()],
      ['apidesigner agent', () => this.apiDesignerResponse()],
      ['techlead agent', () => this.techLeadResponse()],
      ['reviewer agent', () => this.reviewerResponse()],
      ['validator agent', () => this.validatorResponse()],
      ['evolution analyst', () => '[]'],
    ];

    for (const [pattern, handler] of stageMap) {
      if (sysLower.includes(pattern)) {
        return { content: handler() };
      }
    }

    // Fallback — return a valid but minimal JSON response to avoid hard failures
    return { content: JSON.stringify({ artifact: '[canary-stub] Unmatched stage', manifest: {} }) };
  }

  // --- Response factories ---

  private researcherResponse(): string {
    return JSON.stringify({
      artifact:
        '## Market Overview\nTodo app market analysis.\n\n## Competitor Analysis\n| Competitor | Core Features | Strengths | Weaknesses |\n|---|---|---|---|\n| Todoist | Tasks | UX | Price |\n\n## Feasibility\nHigh.\n\n## Key Insights\n- Keep it simple',
      manifest: {
        competitors: ['Todoist'],
        key_insights: ['simplicity'],
        feasibility: 'high',
        risks: [],
      },
    });
  }

  private productOwnerResponse(): string {
    return JSON.stringify({
      artifact:
        '## Goal\nA minimal todo app.\n\n## Features\n- task-crud: Create, complete, delete tasks\n- task-filter: Filter by status\n\n## Constraints\n- Single-page app\n\n## Out of Scope\n- Multi-user',
      manifest: {
        features: [
          { id: 'F-001', name: 'task-crud' },
          { id: 'F-002', name: 'task-filter' },
        ],
        constraints: ['spa'],
        out_of_scope: ['multi-user'],
      },
    });
  }

  private uxDesignerResponse(): string {
    return JSON.stringify({
      artifact:
        '## User Journeys\n### Flow 1: task-management\nAdd task -> Complete -> Delete\n\n### Flow 2: task-filtering\nView all -> Filter active\n\n## Interaction Rules\n- inline-edit\n\n## Component Inventory\n- TaskInput\n- TaskItem\n- TaskFilter',
      manifest: {
        flows: [
          { name: 'task-management', covers_features: ['F-001'] },
          { name: 'task-filtering', covers_features: ['F-002'] },
        ],
        components: ['TaskInput', 'TaskItem', 'TaskFilter'],
        interaction_rules: ['inline-edit'],
      },
    });
  }

  private apiDesignerResponse(): string {
    return JSON.stringify({
      artifact:
        'openapi: "3.0.0"\ninfo:\n  title: Todo API\n  version: "1.0.0"\npaths:\n  /tasks:\n    get:\n      summary: List tasks\n      responses:\n        "200":\n          description: Task list\n    post:\n      summary: Create task\n      responses:\n        "201":\n          description: Task created',
      manifest: {
        endpoints: [
          { method: 'GET', path: '/tasks', covers_features: ['F-001'] },
          { method: 'POST', path: '/tasks', covers_features: ['F-001'] },
        ],
        models: ['Task'],
      },
    });
  }

  private uiPlannerResponse(): string {
    return `<!-- ARTIFACT:ui-plan.json -->
{
  "design_tokens": {"primary": "blue-600"},
  "components": [
    {"name": "TaskInput", "file": "components/TaskInput.tsx", "preview": "previews/TaskInput.html", "purpose": "Add task", "covers_features": ["F-001"], "parent": null, "children": [], "props": ["onAdd: (text: string) => void"], "priority": 1, "category": "atomic"}
  ]
}
<!-- END:ui-plan.json -->`;
  }

  private uiBuilderResponse(): string {
    this.uiBuilderCallCount++;
    return `<!-- ARTIFACT:components/TaskInput.tsx -->
export default function TaskInput() {
  return (
    <div className="flex gap-2 p-4">
      <input type="text" placeholder="Add task" className="flex-1 p-2 border rounded" />
      <button className="bg-blue-500 text-white px-4 py-2 rounded">Add</button>
    </div>
  );
}
<!-- END:components/TaskInput.tsx -->

<!-- ARTIFACT:previews/TaskInput.html -->
<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="flex gap-2 p-4"><input type="text" placeholder="Add task" class="flex-1 p-2 border rounded" /><button class="bg-blue-500 text-white px-4 py-2 rounded">Add</button></div></body></html>
<!-- END:previews/TaskInput.html -->`;
  }

  private techLeadResponse(): string {
    // Must match TechSpecManifestSchema
    return JSON.stringify({
      artifact:
        '# Technical Specification\n\n## Architecture\nSimple SPA with REST API.\n\n## Technology Stack\n- Frontend: React + Tailwind\n- Backend: Node.js + Express\n- Database: SQLite\n\n## Module Design\n### task-api\nREST endpoints for CRUD operations.\n\n## Deployment\nDocker container.',
      manifest: {
        modules: [
          { name: 'task-api', description: 'REST endpoints for task CRUD', covers_features: ['F-001', 'F-002'] },
        ],
        tech_stack: ['react', 'tailwindcss', 'express', 'better-sqlite3'],
        implementation_tasks: [
          { id: 'T-001', name: 'Implement task API endpoints', module: 'task-api', covers_features: ['F-001'] },
          { id: 'T-002', name: 'Implement task filtering', module: 'task-api', covers_features: ['F-002'] },
        ],
      },
    });
  }

  private reviewerResponse(): string {
    // Must match ReviewManifestSchema: issues[{severity,file,description}], spec_coverage{total_tasks,covered_tasks,missing_tasks[]}, verdict
    return JSON.stringify({
      artifact:
        '# Code Review Report\n\n## Summary\nCode quality is acceptable.\n\n## Verdict: APPROVED\n\n## Findings\n- Code follows project conventions\n- Error handling is adequate\n- No performance concerns\n\n## Recommendations\nNone.',
      manifest: {
        issues: [],
        spec_coverage: {
          total_tasks: 2,
          covered_tasks: 2,
          missing_tasks: [],
        },
        verdict: 'pass',
      },
    });
  }

  private validatorResponse(): string {
    return `<!-- ARTIFACT:validation-report.md -->
## Validation Summary
- Status: PASS
- Checks passed: 6/6

### Check 1: PRD <-> UX Flows Coverage
- Status: PASS

### Check 2: UX Flows <-> API Coverage
- Status: PASS

### Check 3: API <-> Components Coverage
- Status: PASS

### Check 4: Naming Consistency
- Status: PASS

### Check 5: File Integrity
- Status: PASS

### Check 6: Feature ID Traceability
- Status: PASS
<!-- END:validation-report.md -->`;
  }
}

// ---------------------------------------------------------------------------
// Mock CLIInteractionHandler — auto-answer clarifications instead of prompting
// The Intent Consultant always creates a CLIInteractionHandler internally,
// which blocks on terminal input. We mock it to auto-select the first option.
// ---------------------------------------------------------------------------
vi.mock('../core/interaction-handler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/interaction-handler.js')>();

  return {
    ...original,
    CLIInteractionHandler: class AutoAnswerCLIHandler {
      async onManualGate() {
        return { approved: true };
      }
      async onClarification(
        _stage: string,
        _question: string,
        _runId: string,
        options?: Array<{ label: string }>,
      ) {
        // Auto-select first option if available, otherwise return a default
        return options?.[0]?.label ?? 'default';
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Mock provider-factory
// ---------------------------------------------------------------------------
vi.mock('../core/provider-factory.js', () => ({
  createProvider: () => new CanaryStubProvider(),
}));

// ---------------------------------------------------------------------------
// Mock agent-factory — all 13 agent classes with typed parameters
// ---------------------------------------------------------------------------
vi.mock('../core/agent-factory.js', async () => {
  const { ResearcherAgent } = await import('../agents/researcher.js');
  const { ProductOwnerAgent } = await import('../agents/product-owner.js');
  const { UXDesignerAgent } = await import('../agents/ux-designer.js');
  const { APIDesignerAgent } = await import('../agents/api-designer.js');
  const { UIDesignerAgent } = await import('../agents/ui-designer.js');
  const { TechLeadAgent } = await import('../agents/tech-lead.js');
  const { QALeadAgent } = await import('../agents/qa-lead.js');
  const { TesterAgent } = await import('../agents/tester.js');
  const { SecurityAuditorAgent } = await import('../agents/security-auditor.js');
  const { ReviewerAgent } = await import('../agents/reviewer.js');
  const { ValidatorAgent } = await import('../agents/validator.js');
  const { BaseAgent } = await import('../core/agent.js');
  const fsLib = await import('node:fs');

  type ProviderParam = import('../core/llm-provider.js').LLMProvider;
  type LoggerParam = import('../core/logger.js').Logger;
  type StageName = import('../core/types.js').StageName;
  type AgentContext = import('../core/types.js').AgentContext;
  type InteractionHandlerParam = import('../core/interaction-handler.js').InteractionHandler;
  type OutputSpec = import('../core/prompt-assembler.js').OutputSpec;

  /**
   * Stub coder that writes deterministic artifacts directly,
   * bypassing the real Coder's multi-pass LLM + shell command flow.
   */
  class CanaryCoderStub extends BaseAgent {
    getOutputSpec(): OutputSpec {
      return { artifacts: ['code/'], manifest: 'code.manifest.json' };
    }

    protected async run(_context: AgentContext): Promise<void> {
      // Write code-plan.json
      const codePlan = {
        project_name: 'todo-app',
        tech_stack: { language: 'TypeScript', framework: 'Express', build_tool: 'tsc' },
        commands: { setupCommand: 'echo ok', verifyCommand: 'echo ok', buildCommand: 'echo ok' },
        modules: [{
          name: 'task-api',
          description: 'API handler for task CRUD',
          files: ['code/src/api.ts'],
          dependencies: [],
          covers_tasks: ['T-001', 'T-002'],
          covers_features: ['F-001', 'F-002'],
          priority: 1,
        }],
      };
      this.writeOutput('code-plan.json', JSON.stringify(codePlan, null, 2));

      // Create code directory and a sample file
      const { getArtifactsDir } = await import('../core/artifact.js');
      const codeDir = `${getArtifactsDir()}/code/src`;
      fsLib.mkdirSync(codeDir, { recursive: true });
      fsLib.writeFileSync(`${codeDir}/api.ts`, 'export function handler() { return "ok"; }');

      // Write code.manifest.json (validated by CodeManifestSchema)
      this.writeOutputManifest('code.manifest.json', {
        files: [{ path: 'code/src/api.ts', module: 'task-api', description: 'API handler' }],
        modules: ['task-api'],
        covers_tasks: ['T-001', 'T-002'],
        covers_features: ['F-001', 'F-002'],
      });
    }
  }

  /**
   * Stub tester that writes a PASS test report,
   * bypassing the real Tester's shell command execution.
   */
  class CanaryTesterStub extends BaseAgent {
    getOutputSpec(): OutputSpec {
      return { artifacts: ['test-report.md'], manifest: 'test-report.manifest.json' };
    }

    protected async run(_context: AgentContext): Promise<void> {
      this.writeOutput(
        'test-report.md',
        '# Test Report\n\n## Summary\n- Total: 5\n- Passed: 5\n- Failed: 0\n\n## Verdict: PASS\n\nAll acceptance tests passed.',
      );
      // Validated by TestReportManifestSchema
      this.writeOutputManifest('test-report.manifest.json', {
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        failures: [],
        verdict: 'pass',
      });
    }
  }

  /**
   * Stub security auditor that writes a PASS report,
   * bypassing the real SecurityAuditor's npm audit + LLM review.
   */
  class CanarySecurityAuditorStub extends BaseAgent {
    getOutputSpec(): OutputSpec {
      return { artifacts: ['security-report.md'], manifest: 'security-report.manifest.json' };
    }

    protected async run(_context: AgentContext): Promise<void> {
      this.writeOutput(
        'security-report.md',
        '# Security Audit Report\n\n## Verdict: PASS\n\n## Automated Scan Results\n- Dependency vulnerabilities: 0\n- Code pattern issues: 0\n- Hardcoded secrets found: 0\n\n## LLM Security Findings\nNo additional vulnerabilities found.',
      );
      // Validated by SecurityReportManifestSchema
      this.writeOutputManifest('security-report.manifest.json', {
        scan_results: {
          dependency_vulnerabilities: 0,
          code_issues: 0,
          secrets_found: 0,
        },
        llm_findings: [],
        verdict: 'pass',
      });
    }
  }

  /**
   * Stub QALead that writes a test plan without using tool use.
   */
  class CanaryQALeadStub extends BaseAgent {
    getOutputSpec(): OutputSpec {
      return { artifacts: ['test-plan.md'], manifest: 'test-plan.manifest.json' };
    }

    protected async run(_context: AgentContext): Promise<void> {
      this.writeOutput(
        'test-plan.md',
        '# Test Plan\n\n## Strategy\nAcceptance testing with Vitest.\n\n## Test Suites\n- task-crud: Create, complete, delete tasks\n- task-filter: Filter by status',
      );
      // Validated by TestPlanManifestSchema
      this.writeOutputManifest('test-plan.manifest.json', {
        test_framework: 'vitest',
        commands: { setupCommand: 'echo ok', runCommand: 'echo ok' },
        test_suites: [
          {
            module: 'task-crud',
            test_file: 'tests/acceptance/features/task-crud.test.ts',
            test_cases: [
              { name: 'create task', covers_tasks: ['T-001'], type: 'integration' },
              { name: 'complete task', covers_tasks: ['T-001'], type: 'integration' },
            ],
          },
        ],
      });
    }
  }

  const STANDARD_AGENTS: Record<string, new (stage: StageName, provider: ProviderParam, logger: LoggerParam) => InstanceType<typeof ResearcherAgent>> = {
    researcher: ResearcherAgent,
    product_owner: ProductOwnerAgent,
    ux_designer: UXDesignerAgent,
    api_designer: APIDesignerAgent,
    ui_designer: UIDesignerAgent,
    tech_lead: TechLeadAgent,
    reviewer: ReviewerAgent,
    validator: ValidatorAgent,
  };

  // Stages that use custom stub agents (too complex for simple LLM mock)
  const STUB_AGENTS: Record<string, new (stage: StageName, provider: ProviderParam, logger: LoggerParam) => InstanceType<typeof BaseAgent>> = {
    coder: CanaryCoderStub,
    tester: CanaryTesterStub,
    security_auditor: CanarySecurityAuditorStub,
    qa_lead: CanaryQALeadStub,
  };

  return {
    createAgent: (
      stage: StageName,
      provider: ProviderParam,
      logger: LoggerParam,
      _autonomy?: unknown,
      _interactionHandler?: InteractionHandlerParam,
    ) => {
      const StubClass = STUB_AGENTS[stage];
      if (StubClass) {
        return new StubClass(stage, provider, logger);
      }
      const AgentClass = STANDARD_AGENTS[stage];
      if (!AgentClass) {
        throw new Error(`Canary test: no agent for stage ${stage}`);
      }
      return new AgentClass(stage, provider, logger);
    },
  };
});

const ARTIFACTS_BASE = '.mosaic/artifacts';

describe('Canary: Full 13-Stage Pipeline', () => {
  beforeEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('should run full 13-stage pipeline and produce all artifacts', async () => {
    const { RunManager } = await import('../core/run-manager.js');
    const manager = new RunManager();

    const runId = await manager.startRun('Canary: full pipeline test', true, 'full');
    const result = await manager.waitForRun(runId);

    // 1. Pipeline completed
    expect(result.completedAt).toBeDefined();

    // 2. Status shows completed
    const status = manager.getStatus(runId);
    expect(status!.state).toBe('completed');

    // Find the run-specific artifacts directory
    const runDirs = fs.readdirSync(ARTIFACTS_BASE).filter((d) => d.startsWith('run-'));
    expect(runDirs.length).toBeGreaterThanOrEqual(1);
    const ARTIFACTS_DIR = path.join(ARTIFACTS_BASE, runDirs[runDirs.length - 1]);

    // 3. All 13 stage artifacts exist on disk
    // -- Design stages (shared with design-only profile) --
    expect(fs.existsSync(`${ARTIFACTS_DIR}/intent-brief.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/research.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/research.manifest.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/prd.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/prd.manifest.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ux-flows.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ux-flows.manifest.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/api-spec.yaml`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/api-spec.manifest.json`)).toBe(true);

    // -- UIDesigner artifacts --
    expect(fs.existsSync(`${ARTIFACTS_DIR}/gallery.html`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ui-plan.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components.manifest.json`)).toBe(true);
    // At least one component file
    const componentsDir = `${ARTIFACTS_DIR}/components`;
    expect(fs.existsSync(componentsDir)).toBe(true);
    const componentFiles = fs.readdirSync(componentsDir);
    expect(componentFiles.length).toBeGreaterThanOrEqual(1);
    // At least one preview file
    const previewsDir = `${ARTIFACTS_DIR}/previews`;
    expect(fs.existsSync(previewsDir)).toBe(true);
    const previewFiles = fs.readdirSync(previewsDir);
    expect(previewFiles.length).toBeGreaterThanOrEqual(1);

    // -- Full-profile stages --
    expect(fs.existsSync(`${ARTIFACTS_DIR}/tech-spec.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/tech-spec.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/test-plan.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/test-plan.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/code-plan.json`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/code.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/test-report.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/test-report.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/security-report.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/security-report.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/review-report.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/review.manifest.json`)).toBe(true);

    expect(fs.existsSync(`${ARTIFACTS_DIR}/validation-report.md`)).toBe(true);

    // 4. All manifest files parse as valid JSON with non-empty content
    const manifests = [
      'research.manifest.json',
      'prd.manifest.json',
      'ux-flows.manifest.json',
      'api-spec.manifest.json',
      'components.manifest.json',
      'tech-spec.manifest.json',
      'test-plan.manifest.json',
      'code.manifest.json',
      'test-report.manifest.json',
      'security-report.manifest.json',
      'review.manifest.json',
    ];
    for (const m of manifests) {
      const filePath = `${ARTIFACTS_DIR}/${m}`;
      expect(fs.existsSync(filePath), `manifest ${m} should exist`).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data, `manifest ${m} should be a non-null object`).toBeDefined();
      expect(typeof data).toBe('object');
      expect(
        Object.keys(data).length,
        `manifest ${m} should have at least one key`,
      ).toBeGreaterThan(0);
    }

    // 5. Count total verified artifacts (at least 20 distinct files)
    const verifiedArtifacts = [
      'intent-brief.json',
      'research.md',
      'research.manifest.json',
      'prd.md',
      'prd.manifest.json',
      'ux-flows.md',
      'ux-flows.manifest.json',
      'api-spec.yaml',
      'api-spec.manifest.json',
      'gallery.html',
      'ui-plan.json',
      'components.manifest.json',
      'tech-spec.md',
      'tech-spec.manifest.json',
      'test-plan.md',
      'test-plan.manifest.json',
      'code-plan.json',
      'code.manifest.json',
      'test-report.md',
      'test-report.manifest.json',
      'security-report.md',
      'security-report.manifest.json',
      'review-report.md',
      'review.manifest.json',
      'validation-report.md',
    ];
    const existingCount = verifiedArtifacts.filter((a) =>
      fs.existsSync(`${ARTIFACTS_DIR}/${a}`),
    ).length;
    expect(existingCount).toBeGreaterThanOrEqual(20);
  }, 120000);
});
