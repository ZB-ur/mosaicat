import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../llm-provider.js';
import { Orchestrator } from '../orchestrator.js';
import { STAGE_ORDER } from '../types.js';

// Mock provider — routes UIDesigner sub-phases by system prompt
class MockLLMProvider implements LLMProvider {
  callCount = 0;
  private uiBuilderCallCount = 0;

  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    this.callCount++;
    const sys = _options?.systemPrompt ?? '';

    // UIDesigner planner sub-phase
    if (sys.includes('UIPlanner') || sys.includes('planning phase of the UI designer')) {
      return { content: `<!-- ARTIFACT:ui-plan.json -->
{
  "components": [
    {"name": "AuthForm", "file": "components/AuthForm.tsx", "preview": "previews/AuthForm.html", "purpose": "Login/register form", "covers_flow": "auth-flow", "parent": null, "children": [], "props": [], "priority": 1},
    {"name": "PostEditor", "file": "components/PostEditor.tsx", "preview": "previews/PostEditor.html", "purpose": "Markdown editor", "covers_flow": "blog-management", "parent": null, "children": [], "props": [], "priority": 2},
    {"name": "PostList", "file": "components/PostList.tsx", "preview": "previews/PostList.html", "purpose": "Blog listing", "covers_flow": "reader-flow", "parent": null, "children": [], "props": [], "priority": 3},
    {"name": "CommentSection", "file": "components/CommentSection.tsx", "preview": "previews/CommentSection.html", "purpose": "Comment thread", "covers_flow": "reader-flow", "parent": null, "children": [], "props": [], "priority": 4}
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

    // Determine which stage based on call count (non-UI stages)
    const stageIndex = this.callCount - 1;
    const stage = STAGE_ORDER[stageIndex];

    switch (stage) {
      case 'researcher':
        return { content: `
<!-- ARTIFACT:research.md -->
## Market Overview
The blog platform market is mature with established players.

## Competitor Analysis
| Competitor | Core Features | Strengths | Weaknesses |
|---|---|---|---|
| WordPress | CMS, plugins | Ecosystem | Complexity |
| Medium | Writing, social | UX | Monetization |

## Feasibility
High feasibility — standard CRUD with auth.

## Key Insights
- Focus on simplicity
- Mobile-first approach
<!-- END:research.md -->

<!-- MANIFEST:research.manifest.json -->
{"competitors": ["WordPress", "Medium"], "key_insights": ["simplicity-focus", "mobile-first"], "feasibility": "high", "risks": ["market-saturation"]}
<!-- END:MANIFEST -->` };

      case 'product_owner':
        return { content: `
<!-- ARTIFACT:prd.md -->
## Goal
Build a simple, modern blog platform for individual creators.

## Features
- user-auth: User registration and login
- blog-crud: Create, read, update, delete blog posts
- blog-comments: Reader commenting system

## Constraints
- Must support markdown content
- Response time < 200ms

## Out of Scope
- Multi-tenancy
- Payment integration
<!-- END:prd.md -->

<!-- MANIFEST:prd.manifest.json -->
{"features": ["user-auth", "blog-crud", "blog-comments"], "constraints": ["markdown-support", "performance-200ms"], "out_of_scope": ["multi-tenancy", "payments"]}
<!-- END:MANIFEST -->` };

      case 'ux_designer':
        return { content: `
<!-- ARTIFACT:ux-flows.md -->
## User Journeys
### Flow 1: auth-flow
Register → Login → Dashboard

### Flow 2: blog-management
Dashboard → Create Post → Edit → Publish

### Flow 3: reader-flow
Browse → Read Post → Comment

## Interaction Rules
- form-validation: Inline validation on blur
- loading-states: Skeleton screens during fetch

## Component Inventory
- AuthForm: Login/register form
- PostEditor: Markdown editor for posts
- PostList: Blog post listing
- CommentSection: Comment thread
<!-- END:ux-flows.md -->

<!-- MANIFEST:ux-flows.manifest.json -->
{"flows": ["auth-flow", "blog-management", "reader-flow"], "components": ["AuthForm", "PostEditor", "PostList", "CommentSection"], "interaction_rules": ["form-validation", "loading-states"]}
<!-- END:MANIFEST -->` };

      case 'api_designer':
        return { content: `
<!-- ARTIFACT:api-spec.yaml -->
openapi: "3.0.0"
info:
  title: Blog API
  version: "1.0.0"
paths:
  /auth/register:
    post:
      summary: Register a new user
      responses:
        "201":
          description: User created
  /auth/login:
    post:
      summary: Login
      responses:
        "200":
          description: JWT token
  /posts:
    get:
      summary: List posts
      responses:
        "200":
          description: Post list
    post:
      summary: Create post
      responses:
        "201":
          description: Post created
  /posts/{id}/comments:
    post:
      summary: Add comment
      responses:
        "201":
          description: Comment created
<!-- END:api-spec.yaml -->

<!-- MANIFEST:api-spec.manifest.json -->
{"endpoints": [{"method": "POST", "path": "/auth/register", "covers_feature": "user-auth"}, {"method": "POST", "path": "/auth/login", "covers_feature": "user-auth"}, {"method": "GET", "path": "/posts", "covers_feature": "blog-crud"}, {"method": "POST", "path": "/posts", "covers_feature": "blog-crud"}, {"method": "POST", "path": "/posts/{id}/comments", "covers_feature": "blog-comments"}], "models": ["User", "Post", "Comment"]}
<!-- END:MANIFEST -->` };

      case 'validator':
        return { content: `
<!-- ARTIFACT:validation-report.md -->
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
    createAgent: (stage: keyof typeof AGENT_MAP, provider: unknown, logger: unknown) => {
      const AgentClass = AGENT_MAP[stage];
      return new AgentClass(stage, provider as any, logger as any);
    },
  };
});

const ARTIFACTS_DIR = '.mosaic/artifacts';
const SNAPSHOTS_DIR = '.mosaic/snapshots';

describe('Orchestrator Integration (Mock LLM)', () => {
  beforeEach(() => {
    // Clean up artifacts and snapshots
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('should run full pipeline with mock LLM and produce all artifacts', async () => {
    const orchestrator = new Orchestrator();
    const result = await orchestrator.run('做一个博客系统', true);

    // Pipeline completed
    expect(result.completedAt).toBeDefined();
    expect(result.currentStage).toBe('validator');

    // All stages done
    for (const stage of STAGE_ORDER) {
      expect(result.stages[stage].state).toBe('done');
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
    expect(fs.existsSync(SNAPSHOTS_DIR)).toBe(true);
    const snapshots = fs.readdirSync(SNAPSHOTS_DIR);
    expect(snapshots.length).toBe(6); // One per stage
  }, 60000);
});
