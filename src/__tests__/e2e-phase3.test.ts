/**
 * Phase 3 E2E Integration Test
 *
 * Verifies all Phase 3 features working together:
 * 1. Anthropic SDK Provider (via mock — unit tested separately)
 * 2. RunManager async pipeline control (MCP foundation)
 * 3. Playwright screenshot rendering integrated into UIDesigner
 * 4. Full pipeline produces artifacts + screenshots
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../core/llm-provider.js';
import { STAGE_ORDER } from '../core/types.js';

// Mock provider with formatted responses for all 6 stages
// UIDesigner uses multi-pass: 1 planner call + N builder calls
// We detect the phase by system prompt content
class MockLLMProvider implements LLMProvider {
  callCount = 0;
  private uiBuilderCallCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    // Detect sub-phases by system prompt
    const sys = _options?.systemPrompt ?? '';
    // Intent Consultant (don't count as stage call)
    if (sys.includes('Intent Consultant') || _prompt.includes('## User Instruction')) {
      return { content: JSON.stringify({ ready_to_converge: true, intent_brief: { problem: "Todo app", target_users: "Individuals", core_scenarios: ["Manage tasks"], mvp_boundary: "Basic CRUD", constraints: [], domain_specifics: [], recommended_profile: "design-only", profile_reason: "Design only" } }) };
    }
    this.callCount++;
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: this.plannerResponse() };
    }
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      return { content: this.builderResponse() };
    }

    // Sequential stage dispatch for non-UIDesigner stages
    // Count only non-UI calls for stage mapping
    const nonUIStages = STAGE_ORDER.filter((s) => s !== 'ui_designer');
    const nonUICallIndex = this.callCount - 1 - (this.uiBuilderCallCount > 0 ? this.uiBuilderCallCount + 1 : 0);
    const stage = nonUIStages[nonUICallIndex] ?? STAGE_ORDER[this.callCount - 1];

    const responses: Record<string, string> = {
      researcher: JSON.stringify({
        artifact: "## Market Overview\nTodo app market analysis.\n\n## Competitor Analysis\n| Competitor | Core Features | Strengths | Weaknesses |\n|---|---|---|---|\n| Todoist | Tasks, projects | UX | Price |\n\n## Feasibility\nHigh — standard CRUD.\n\n## Key Insights\n- Keep it simple",
        manifest: { competitors: ["Todoist"], key_insights: ["simplicity"], feasibility: "high", risks: [] },
      }),

      product_owner: JSON.stringify({
        artifact: "## Goal\nA minimal todo app for personal task management.\n\n## Features\n- task-crud: Create, complete, delete tasks\n- task-filter: Filter by status\n\n## Constraints\n- Single-page app\n- Local storage\n\n## Out of Scope\n- Multi-user\n- Cloud sync",
        manifest: { features: ["task-crud", "task-filter"], constraints: ["spa", "local-storage"], out_of_scope: ["multi-user", "cloud-sync"] },
      }),

      ux_designer: JSON.stringify({
        artifact: "## User Journeys\n### Flow 1: task-management\nAdd task → Complete task → Delete task\n\n### Flow 2: task-filtering\nView all → Filter active → Filter completed\n\n## Interaction Rules\n- inline-edit: Click to edit task text\n- swipe-delete: Swipe left to delete\n\n## Component Inventory\n- TaskInput: Add new task\n- TaskItem: Single task with checkbox\n- TaskFilter: Filter buttons",
        manifest: { flows: ["task-management", "task-filtering"], components: ["TaskInput", "TaskItem", "TaskFilter"], interaction_rules: ["inline-edit", "swipe-delete"] },
      }),

      api_designer: JSON.stringify({
        artifact: "openapi: \"3.0.0\"\ninfo:\n  title: Todo API\n  version: \"1.0.0\"\npaths:\n  /tasks:\n    get:\n      summary: List tasks\n      responses:\n        \"200\":\n          description: Task list\n    post:\n      summary: Create task\n      responses:\n        \"201\":\n          description: Task created\n  /tasks/{id}:\n    patch:\n      summary: Update task\n      responses:\n        \"200\":\n          description: Task updated\n    delete:\n      summary: Delete task\n      responses:\n        \"204\":\n          description: Task deleted",
        manifest: { endpoints: [{ method: "GET", path: "/tasks", covers_feature: "task-crud" }, { method: "POST", path: "/tasks", covers_feature: "task-crud" }, { method: "PATCH", path: "/tasks/{id}", covers_feature: "task-crud" }, { method: "DELETE", path: "/tasks/{id}", covers_feature: "task-crud" }], models: ["Task"] },
      }),

      validator: `<!-- ARTIFACT:validation-report.md -->\n## Validation Summary\n- Status: PASS\n- Checks passed: 4/4\n\n### Check 1: PRD ↔ UX Flows Coverage\n- Status: PASS\n- task-crud → task-management\n- task-filter → task-filtering\n\n### Check 2: UX Flows ↔ API Coverage\n- Status: PASS\n\n### Check 3: API ↔ Components Coverage\n- Status: PASS\n\n### Check 4: Naming Consistency\n- Status: PASS\n<!-- END:validation-report.md -->`,
    };

    return { content: responses[stage!] ?? '[mock] unknown' };
  }

  private plannerResponse(): string {
    return `<!-- ARTIFACT:ui-plan.json -->
{
  "design_tokens": {"primary": "blue-600", "background": "slate-50"},
  "components": [
    {"name": "TaskInput", "file": "components/TaskInput.tsx", "preview": "previews/TaskInput.html", "purpose": "Add new task", "covers_flow": "task-management", "parent": null, "children": [], "props": ["onAdd: (text: string) => void"], "priority": 1},
    {"name": "TaskItem", "file": "components/TaskItem.tsx", "preview": "previews/TaskItem.html", "purpose": "Single task row", "covers_flow": "task-management", "parent": null, "children": [], "props": ["task: Task", "onToggle: () => void"], "priority": 2},
    {"name": "TaskFilter", "file": "components/TaskFilter.tsx", "preview": "previews/TaskFilter.html", "purpose": "Filter buttons", "covers_flow": "task-filtering", "parent": null, "children": [], "props": ["filter: string", "onChange: (f: string) => void"], "priority": 3}
  ]
}
<!-- END:ui-plan.json -->`;
  }

  private builderResponse(): string {
    this.uiBuilderCallCount++;
    const components: Record<number, { name: string; tsx: string; html: string }> = {
      1: {
        name: 'TaskInput',
        tsx: `export default function TaskInput() {\n  return (\n    <div className="flex gap-2 p-4">\n      <input type="text" placeholder="What needs to be done?" className="flex-1 p-2 border rounded" />\n      <button className="bg-blue-500 text-white px-4 py-2 rounded">Add</button>\n    </div>\n  );\n}`,
        html: `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body { margin: 0; padding: 16px; background: #f8fafc; font-family: system-ui, sans-serif; }</style></head><body><div class="flex gap-2 p-4"><input type="text" placeholder="What needs to be done?" class="flex-1 p-2 border rounded" /><button class="bg-blue-500 text-white px-4 py-2 rounded">Add</button></div></body></html>`,
      },
      2: {
        name: 'TaskItem',
        tsx: `export default function TaskItem() {\n  return (\n    <div className="flex items-center gap-3 p-3 border-b">\n      <input type="checkbox" className="w-5 h-5" />\n      <span className="flex-1">Sample task</span>\n      <button className="text-red-500 hover:text-red-700">Delete</button>\n    </div>\n  );\n}`,
        html: `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body { margin: 0; padding: 16px; background: #f8fafc; font-family: system-ui, sans-serif; }</style></head><body><div class="flex items-center gap-3 p-3 border-b"><input type="checkbox" class="w-5 h-5" /><span class="flex-1">Sample task</span><button class="text-red-500 hover:text-red-700">Delete</button></div></body></html>`,
      },
      3: {
        name: 'TaskFilter',
        tsx: `export default function TaskFilter() {\n  return (\n    <div className="flex gap-2 p-4 border-t">\n      <button className="px-3 py-1 rounded bg-gray-200">All</button>\n      <button className="px-3 py-1 rounded">Active</button>\n      <button className="px-3 py-1 rounded">Completed</button>\n    </div>\n  );\n}`,
        html: `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><style>body { margin: 0; padding: 16px; background: #f8fafc; font-family: system-ui, sans-serif; }</style></head><body><div class="flex gap-2 p-4 border-t"><button class="px-3 py-1 rounded bg-gray-200">All</button><button class="px-3 py-1 rounded">Active</button><button class="px-3 py-1 rounded">Completed</button></div></body></html>`,
      },
    };

    const comp = components[this.uiBuilderCallCount] ?? components[1];
    return `<!-- ARTIFACT:components/${comp.name}.tsx -->\n${comp.tsx}\n<!-- END:components/${comp.name}.tsx -->\n\n<!-- ARTIFACT:previews/${comp.name}.html -->\n${comp.html}\n<!-- END:previews/${comp.name}.html -->`;
  }
}

vi.mock('../core/provider-factory.js', () => ({
  createProvider: () => new MockLLMProvider(),
}));

vi.mock('../core/agent-factory.js', async () => {
  const { ResearcherAgent } = await import('../agents/researcher.js');
  const { ProductOwnerAgent } = await import('../agents/product-owner.js');
  const { UXDesignerAgent } = await import('../agents/ux-designer.js');
  const { APIDesignerAgent } = await import('../agents/api-designer.js');
  const { UIDesignerAgent } = await import('../agents/ui-designer.js');
  const { ValidatorAgent } = await import('../agents/validator.js');

  const AGENT_MAP = {
    researcher: ResearcherAgent,
    product_owner: ProductOwnerAgent,
    ux_designer: UXDesignerAgent,
    api_designer: APIDesignerAgent,
    ui_designer: UIDesignerAgent,
    validator: ValidatorAgent,
  } as const;

  return {
    createAgent: (stage: keyof typeof AGENT_MAP, provider: unknown, logger: unknown) => {
      const AgentClass = AGENT_MAP[stage];
      return new AgentClass(stage, provider as any, logger as any);
    },
  };
});

const ARTIFACTS_DIR = '.mosaic/artifacts';

describe('Phase 3 E2E Integration', () => {
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

  it('should run full pipeline via RunManager and produce artifacts + screenshots', async () => {
    const { RunManager } = await import('../core/run-manager.js');
    const manager = new RunManager();

    const runId = await manager.startRun('做一个待办事项应用', true);
    const result = await manager.waitForRun(runId);

    // Pipeline completed
    expect(result.completedAt).toBeDefined();

    // Status shows completed
    const status = manager.getStatus(runId);
    expect(status!.state).toBe('completed');

    // All 6 main artifacts exist
    expect(fs.existsSync(`${ARTIFACTS_DIR}/research.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/prd.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ux-flows.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/api-spec.yaml`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/validation-report.md`)).toBe(true);

    // Component files exist
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/TaskInput.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/TaskItem.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/TaskFilter.tsx`)).toBe(true);

    // Preview HTML files exist
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/TaskInput.html`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/TaskItem.html`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/previews/TaskFilter.html`)).toBe(true);

    // Screenshots produced by Playwright from preview HTML
    expect(fs.existsSync(`${ARTIFACTS_DIR}/screenshots/TaskInput.png`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/screenshots/TaskItem.png`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/screenshots/TaskFilter.png`)).toBe(true);

    // Screenshots have non-zero size
    for (const name of ['TaskInput', 'TaskItem', 'TaskFilter']) {
      const stat = fs.statSync(`${ARTIFACTS_DIR}/screenshots/${name}.png`);
      expect(stat.size).toBeGreaterThan(0);
    }

    // Gallery HTML exists
    expect(fs.existsSync(`${ARTIFACTS_DIR}/gallery.html`)).toBe(true);
    const galleryContent = fs.readFileSync(`${ARTIFACTS_DIR}/gallery.html`, 'utf-8');
    expect(galleryContent).toContain('Component Gallery');
    expect(galleryContent).toContain('data:image/png;base64,');

    // ui-plan.json exists (new multi-pass artifact)
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ui-plan.json`)).toBe(true);

    // All 5 manifests are valid JSON
    const manifests = [
      'research.manifest.json',
      'prd.manifest.json',
      'ux-flows.manifest.json',
      'api-spec.manifest.json',
      'components.manifest.json',
    ];
    for (const m of manifests) {
      const data = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/${m}`, 'utf-8'));
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    }
  }, 60000);

  it('should produce meaningful artifact content', async () => {
    const { RunManager } = await import('../core/run-manager.js');
    const manager = new RunManager();

    const runId = await manager.startRun('todo app', true);
    await manager.waitForRun(runId);

    // PRD has features
    const prd = fs.readFileSync(`${ARTIFACTS_DIR}/prd.md`, 'utf-8');
    expect(prd).toContain('task-crud');
    expect(prd).toContain('task-filter');

    // Manifest cross-references work
    const prdManifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/prd.manifest.json`, 'utf-8'));
    const apiManifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/api-spec.manifest.json`, 'utf-8'));
    const compManifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/components.manifest.json`, 'utf-8'));

    // PRD features should be covered by API endpoints
    for (const ep of apiManifest.endpoints) {
      expect(prdManifest.features).toContain(ep.covers_feature);
    }

    // Components should reference UX flows
    for (const comp of compManifest.components) {
      expect(comp.covers_flow).toBeDefined();
    }

    // Validation passed (4 LLM checks + 1 programmatic file integrity check = 5)
    const report = fs.readFileSync(`${ARTIFACTS_DIR}/validation-report.md`, 'utf-8');
    expect(report).toContain('PASS');
    expect(report).toContain('Check 5: File Integrity');
  }, 60000);
});
