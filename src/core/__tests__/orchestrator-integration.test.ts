import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../llm-provider.js';
import type { Logger } from '../logger.js';
import { Orchestrator } from '../orchestrator.js';
import { DEFAULT_STAGES } from '../types.js';
import { createTestMosaicDir, cleanupTestMosaicDir } from '../../__tests__/test-helpers.js';
import { getArtifactsDir } from '../artifact.js';

// Mock provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;
  private stageCallCount = 0;
  private uiBuilderCallCount = 0;
  private intentConsultantDone = false;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    const sys = _options?.systemPrompt ?? '';

    // Intent Consultant — first non-UI call is always the consultant
    if (!this.intentConsultantDone && (sys.includes('Intent Consultant') || sys.includes('intent consultant') || _prompt.includes('## User Instruction'))) {
      this.intentConsultantDone = true;
      return { content: JSON.stringify({
        ready_to_converge: true,
        intent_brief: { problem: "Blog platform", target_users: "Individual creators", core_scenarios: ["Write posts", "Read posts", "Comment"], mvp_boundary: "Basic blog CRUD", constraints: ["markdown-support"], domain_specifics: [], recommended_profile: "design-only", profile_reason: "Design only for MVP" },
      }) };
    }

    this.callCount++;

    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->
{
  "components": [
    {"name": "AuthForm", "file": "components/AuthForm.tsx", "preview": "previews/AuthForm.html", "purpose": "Login/register form", "covers_features": ["F-001"], "parent": null, "children": [], "props": [], "priority": 1},
    {"name": "PostEditor", "file": "components/PostEditor.tsx", "preview": "previews/PostEditor.html", "purpose": "Markdown editor", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 2},
    {"name": "PostList", "file": "components/PostList.tsx", "preview": "previews/PostList.html", "purpose": "Blog listing", "covers_features": ["F-002"], "parent": null, "children": [], "props": [], "priority": 3},
    {"name": "CommentSection", "file": "components/CommentSection.tsx", "preview": "previews/CommentSection.html", "purpose": "Comment thread", "covers_features": ["F-003"], "parent": null, "children": [], "props": [], "priority": 4}
  ]
}
<!-- END:ui-plan.json -->` };
    }

    // UIDesigner builder sub-phase
    if (sys.includes('UIBuilder') || sys.includes('builder phase of the UI designer')) {
      this.uiBuilderCallCount++;
      const builders: Record<number, string> = {
        1: `<!-- ARTIFACT:components/AuthForm.tsx -->\nexport default function AuthForm() {\n  return (\n    <form className="p-4 max-w-md mx-auto">\n      <input type="email" placeholder="Email" className="w-full p-2 border rounded mb-2" />\n      <input type="password" placeholder="Password" className="w-full p-2 border rounded mb-2" />\n      <button className="w-full bg-blue-500 text-white p-2 rounded">Login</button>\n    </form>\n  );\n}\n<!-- END:components/AuthForm.tsx -->\n\n<!-- ARTIFACT:previews/AuthForm.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><form class="p-4 max-w-md mx-auto"><input type="email" placeholder="Email" class="w-full p-2 border rounded mb-2" /><input type="password" placeholder="Password" class="w-full p-2 border rounded mb-2" /><button class="w-full bg-blue-500 text-white p-2 rounded">Login</button></form></body></html>\n<!-- END:previews/AuthForm.html -->`,
        2: `<!-- ARTIFACT:components/PostEditor.tsx -->\nexport default function PostEditor() {\n  return (\n    <div className="p-4 max-w-2xl mx-auto">\n      <input type="text" placeholder="Post title" className="w-full p-2 border rounded mb-2 text-xl" />\n      <textarea placeholder="Write in markdown..." className="w-full p-2 border rounded h-64" />\n      <button className="mt-2 bg-green-500 text-white p-2 rounded">Publish</button>\n    </div>\n  );\n}\n<!-- END:components/PostEditor.tsx -->\n\n<!-- ARTIFACT:previews/PostEditor.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4 max-w-2xl mx-auto"><input type="text" placeholder="Post title" class="w-full p-2 border rounded mb-2 text-xl" /><textarea placeholder="Write in markdown..." class="w-full p-2 border rounded h-64"></textarea><button class="mt-2 bg-green-500 text-white p-2 rounded">Publish</button></div></body></html>\n<!-- END:previews/PostEditor.html -->`,
        3: `<!-- ARTIFACT:components/PostList.tsx -->\nexport default function PostList() {\n  return (\n    <div className="p-4 max-w-2xl mx-auto">\n      <h1 className="text-2xl font-bold mb-4">Blog Posts</h1>\n      <div className="space-y-4"><div className="p-4 border rounded"><h2 className="text-xl">Sample Post</h2><p className="text-gray-600">Post preview...</p></div></div>\n    </div>\n  );\n}\n<!-- END:components/PostList.tsx -->\n\n<!-- ARTIFACT:previews/PostList.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4 max-w-2xl mx-auto"><h1 class="text-2xl font-bold mb-4">Blog Posts</h1><div class="space-y-4"><div class="p-4 border rounded"><h2 class="text-xl">Sample Post</h2><p class="text-gray-600">Post preview...</p></div></div></div></body></html>\n<!-- END:previews/PostList.html -->`,
        4: `<!-- ARTIFACT:components/CommentSection.tsx -->\nexport default function CommentSection() {\n  return (\n    <div className="p-4 border-t mt-4">\n      <h3 className="text-lg font-bold mb-2">Comments</h3>\n      <textarea placeholder="Add a comment..." className="w-full p-2 border rounded mb-2" />\n      <button className="bg-blue-500 text-white px-4 py-1 rounded">Submit</button>\n    </div>\n  );\n}\n<!-- END:components/CommentSection.tsx -->\n\n<!-- ARTIFACT:previews/CommentSection.html -->\n<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4 border-t mt-4"><h3 class="text-lg font-bold mb-2">Comments</h3><textarea placeholder="Add a comment..." class="w-full p-2 border rounded mb-2"></textarea><button class="bg-blue-500 text-white px-4 py-1 rounded">Submit</button></div></body></html>\n<!-- END:previews/CommentSection.html -->`,
      };
      return { content: builders[this.uiBuilderCallCount] ?? builders[1]! };
    }

    // Determine which stage based on non-UI call count
    const nonUIStages = DEFAULT_STAGES.filter((s) => s !== 'ui_designer');
    const stage = nonUIStages[this.stageCallCount];
    this.stageCallCount++;

    switch (stage) {
      case 'researcher':
        // LLMAgent expects JSON: { artifact, manifest }
        return { content: JSON.stringify({
          artifact: `## Market Overview\nThe blog platform market is mature with established players.\n\n## Competitor Analysis\n| Competitor | Core Features | Strengths | Weaknesses |\n|---|---|---|---|\n| WordPress | CMS, plugins | Ecosystem | Complexity |\n| Medium | Writing, social | UX | Monetization |\n\n## Feasibility\nHigh feasibility — standard CRUD with auth.\n\n## Key Insights\n- Focus on simplicity\n- Mobile-first approach`,
          manifest: { competitors: ["WordPress", "Medium"], key_insights: ["simplicity-focus", "mobile-first"], feasibility: "high", risks: ["market-saturation"] },
        }) };

      case 'product_owner':
        return { content: JSON.stringify({
          artifact: `## Goal\nBuild a simple, modern blog platform for individual creators.\n\n## Features\n- user-auth: User registration and login\n- blog-crud: Create, read, update, delete blog posts\n- blog-comments: Reader commenting system\n\n## Constraints\n- Must support markdown content\n- Response time < 200ms\n\n## Out of Scope\n- Multi-tenancy\n- Payment integration`,
          manifest: { features: [{ id: "F-001", name: "user-auth" }, { id: "F-002", name: "blog-crud" }, { id: "F-003", name: "blog-comments" }], constraints: ["markdown-support", "performance-200ms"], out_of_scope: ["multi-tenancy", "payments"] },
        }) };

      case 'ux_designer':
        return { content: JSON.stringify({
          artifact: `## User Journeys\n### Flow 1: auth-flow\nRegister → Login → Dashboard\n\n### Flow 2: blog-management\nDashboard → Create Post → Edit → Publish\n\n### Flow 3: reader-flow\nBrowse → Read Post → Comment\n\n## Interaction Rules\n- form-validation: Inline validation on blur\n- loading-states: Skeleton screens during fetch\n\n## Component Inventory\n- AuthForm: Login/register form\n- PostEditor: Markdown editor for posts\n- PostList: Blog post listing\n- CommentSection: Comment thread`,
          manifest: { flows: [{ name: "auth-flow", covers_features: ["F-001"] }, { name: "blog-management", covers_features: ["F-002"] }, { name: "reader-flow", covers_features: ["F-003"] }], components: ["AuthForm", "PostEditor", "PostList", "CommentSection"], interaction_rules: ["form-validation", "loading-states"] },
        }) };

      case 'api_designer':
        return { content: JSON.stringify({
          artifact: `openapi: "3.0.0"\ninfo:\n  title: Blog API\n  version: "1.0.0"\npaths:\n  /auth/register:\n    post:\n      summary: Register a new user\n      responses:\n        "201":\n          description: User created\n  /auth/login:\n    post:\n      summary: Login\n      responses:\n        "200":\n          description: JWT token\n  /posts:\n    get:\n      summary: List posts\n      responses:\n        "200":\n          description: Post list\n    post:\n      summary: Create post\n      responses:\n        "201":\n          description: Post created\n  /posts/{id}/comments:\n    post:\n      summary: Add comment\n      responses:\n        "201":\n          description: Comment created`,
          manifest: { endpoints: [{"method": "POST", "path": "/auth/register", "covers_features": ["F-001"]}, {"method": "POST", "path": "/auth/login", "covers_features": ["F-001"]}, {"method": "GET", "path": "/posts", "covers_features": ["F-002"]}, {"method": "POST", "path": "/posts", "covers_features": ["F-002"]}, {"method": "POST", "path": "/posts/{id}/comments", "covers_features": ["F-003"]}], models: ["User", "Post", "Comment"] },
        }) };

      case 'validator':
        // Validator has its own run() and still uses delimiter format
        return { content: `<!-- ARTIFACT:validation-report.md -->
## Validation Summary
- Status: PASS
- Checks passed: 4/4

## Detail
### Check 1: PRD ↔ UX Flows Coverage
- Status: PASS
- Coverage: 3/3 features covered
- user-auth → auth-flow
- blog-crud → blog-management
- blog-comments → reader-flow

### Check 2: UX Flows ↔ API Coverage
- Status: PASS
- Coverage: 3/3 flows covered

### Check 3: API ↔ Components Coverage
- Status: PASS
- All models consumed by components

### Check 4: Naming Consistency
- Status: PASS
- Terminology consistent across artifacts
<!-- END:validation-report.md -->` };

      default:
        return { content: '[mock] Unknown stage' };
    }
  }
}

// Override createProvider to use mock
import { vi } from 'vitest';
vi.mock('../provider-factory.js', () => ({
  createProvider: () => new MockLLMProvider(),
}));

// Override createAgent to use real agents (not StubAgent)
vi.mock('../agent-factory.js', async () => {
  const { ResearcherAgent } = await import('../../agents/researcher.js');
  const { ProductOwnerAgent } = await import('../../agents/product-owner.js');
  const { UXDesignerAgent } = await import('../../agents/ux-designer.js');
  const { APIDesignerAgent } = await import('../../agents/api-designer.js');
  const { UIDesignerAgent } = await import('../../agents/ui-designer.js');
  const { ValidatorAgent } = await import('../../agents/validator.js');

  const AGENT_MAP = {
    researcher: ResearcherAgent,
    product_owner: ProductOwnerAgent,
    ux_designer: UXDesignerAgent,
    api_designer: APIDesignerAgent,
    ui_designer: UIDesignerAgent,
    validator: ValidatorAgent,
  } as const;

  return {
    createAgent: (stage: keyof typeof AGENT_MAP, ctx: import('../run-context.js').RunContext) => {
      const AgentClass = AGENT_MAP[stage];
      return new AgentClass(stage, ctx);
    },
  };
});

describe('Orchestrator Integration (Mock LLM)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = createTestMosaicDir();
  });

  afterEach(() => {
    cleanupTestMosaicDir(tmpRoot);
  });

  it('should run full pipeline with mock LLM and produce all artifacts', async () => {
    const orchestrator = new Orchestrator();
    const result = await orchestrator.run('做一个博客系统', true);
    const ARTIFACTS_DIR = getArtifactsDir();

    // Pipeline completed
    expect(result.completedAt).toBeDefined();
    expect(result.currentStage).toBe('validator');

    // All stages done
    for (const stage of DEFAULT_STAGES) {
      expect(result.stages[stage]!.state).toBe('done');
    }

    // Artifacts exist
    expect(fs.existsSync(`${ARTIFACTS_DIR}/research.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/prd.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/ux-flows.md`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/api-spec.yaml`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/validation-report.md`)).toBe(true);

    // Component files exist
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/AuthForm.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/PostEditor.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/PostList.tsx`)).toBe(true);
    expect(fs.existsSync(`${ARTIFACTS_DIR}/components/CommentSection.tsx`)).toBe(true);

    // Manifests exist and are valid JSON
    const manifests = [
      'research.manifest.json',
      'prd.manifest.json',
      'ux-flows.manifest.json',
      'api-spec.manifest.json',
      'components.manifest.json',
    ];
    for (const m of manifests) {
      const path = `${ARTIFACTS_DIR}/${m}`;
      expect(fs.existsSync(path)).toBe(true);
      const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    }

    // Verify artifact content is meaningful
    const research = fs.readFileSync(`${ARTIFACTS_DIR}/research.md`, 'utf-8');
    expect(research).toContain('Market Overview');
    expect(research).toContain('WordPress');

    const prd = fs.readFileSync(`${ARTIFACTS_DIR}/prd.md`, 'utf-8');
    expect(prd).toContain('blog');

    // Verify manifest content
    const prdManifest = JSON.parse(fs.readFileSync(`${ARTIFACTS_DIR}/prd.manifest.json`, 'utf-8'));
    expect(prdManifest.features).toContain('user-auth');
    expect(prdManifest.features).toContain('blog-crud');
  }, 60000);

  it('should create snapshots for all stages', async () => {
    const orchestrator = new Orchestrator();
    await orchestrator.run('做一个博客系统', true);

    // Snapshots directory should exist with entries
    const SNAPSHOTS_DIR = '.mosaic/snapshots';
    expect(fs.existsSync(SNAPSHOTS_DIR)).toBe(true);
    const snapshots = fs.readdirSync(SNAPSHOTS_DIR);
    expect(snapshots.length).toBe(6); // One per stage
    // Clean up snapshots (not covered by temp dir isolation)
    fs.rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  }, 60000);
});
