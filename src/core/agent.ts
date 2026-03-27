import type { AgentContext, StageName } from './types.js';
import type { LLMProvider } from './llm-provider.js';
import type { Logger } from './logger.js';
import type { RunContext } from './run-context.js';
import { writeManifest } from './manifest.js';

// --- Agent Hook Interfaces ---

export interface AgentHookResult {
  pass: boolean;
  message?: string;
}

export interface PreRunHook {
  name: string;
  mandatory: boolean;
  execute(context: AgentContext): Promise<AgentHookResult>;
}

export interface PostRunHook {
  name: string;
  mandatory: boolean;
  execute(context: AgentContext, output: string): Promise<AgentHookResult>;
}

export class HookFailedError extends Error {
  constructor(hookName: string, message?: string) {
    super(`Hook "${hookName}" failed: ${message ?? 'no details'}`);
    this.name = 'HookFailedError';
  }
}

export abstract class BaseAgent {
  protected readonly ctx: RunContext;
  readonly stage: StageName;
  protected preRunHooks: PreRunHook[] = [];
  protected postRunHooks: PostRunHook[] = [];
  private lastOutput = '';

  /** Convenience getter — forwards to ctx.provider */
  protected get provider(): LLMProvider { return this.ctx.provider; }
  /** Convenience getter — forwards to ctx.logger */
  protected get logger(): Logger { return this.ctx.logger; }

  constructor(stage: StageName, ctx: RunContext) {
    this.stage = stage;
    this.ctx = ctx;
  }

  /** Register a pre-run hook */
  addPreRunHook(hook: PreRunHook): void {
    this.preRunHooks.push(hook);
  }

  /** Register a post-run hook */
  addPostRunHook(hook: PostRunHook): void {
    this.postRunHooks.push(hook);
  }

  async execute(context: AgentContext): Promise<void> {
    const inputs = Array.from(context.inputArtifacts.keys());
    this.logger.agent(this.stage, 'info', 'agent:start', { inputs });
    this.ctx.eventBus.emit('agent:context', this.stage, inputs);

    // 1. Run pre-run hooks
    for (const hook of this.preRunHooks) {
      const result = await hook.execute(context);
      if (!result.pass && hook.mandatory) {
        this.logger.agent(this.stage, 'error', 'hook:mandatory-failed', { hook: hook.name, message: result.message });
        throw new HookFailedError(hook.name, result.message);
      }
      if (!result.pass) {
        this.logger.agent(this.stage, 'warn', 'hook:optional-failed', { hook: hook.name, message: result.message });
      }
    }

    try {
      // 2. Run agent
      await this.run(context);
      this.logger.agent(this.stage, 'info', 'agent:complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.agent(this.stage, 'error', 'agent:error', { error: message });
      throw err;
    }

    // 3. Run post-run hooks
    for (const hook of this.postRunHooks) {
      const result = await hook.execute(context, this.lastOutput);
      if (!result.pass && hook.mandatory) {
        this.logger.agent(this.stage, 'error', 'hook:mandatory-failed', { hook: hook.name, message: result.message });
        throw new HookFailedError(hook.name, result.message);
      }
      if (!result.pass) {
        this.logger.agent(this.stage, 'warn', 'hook:optional-failed', { hook: hook.name, message: result.message });
      }
    }
  }

  protected abstract run(context: AgentContext): Promise<void>;

  /** Append an entry to run-memory.md for downstream agents */
  protected appendRunMemory(entry: string): void {
    const memoryFile = 'run-memory.md';
    let existing = '';
    try {
      if (this.ctx.store.exists(memoryFile)) {
        existing = this.ctx.store.read(memoryFile);
      }
    } catch { /* first entry */ }
    const header = `### ${this.stage} (${new Date().toISOString()})`;
    const updated = existing ? `${existing}\n\n${header}\n${entry}` : `# Run Memory\n\n${header}\n${entry}`;
    this.ctx.store.write(memoryFile, updated);
  }

  protected writeOutput(name: string, content: string): void {
    this.ctx.store.write(name, content);
    this.lastOutput = content;
    this.logger.agent(this.stage, 'info', 'artifact:written', { name });
    this.ctx.eventBus.emit('artifact:written', this.stage, name, content.length);
  }

  protected writeOutputManifest(name: string, data: unknown): void {
    writeManifest(this.ctx.store, name, data);
    this.logger.agent(this.stage, 'info', 'manifest:written', { name });
    this.ctx.eventBus.emit('manifest:written', this.stage, name);
  }
}

// --- Stub Agent for Phase 1 ---

interface StubOutputDef {
  artifact: string;
  content: string;
  manifest?: { name: string; data: unknown };
}

const STUB_OUTPUTS: Partial<Record<StageName, StubOutputDef>> = {
  researcher: {
    artifact: 'research.md',
    content: `## Market Overview\n[Stub] Market analysis placeholder.\n\n## Competitor Analysis\n| Competitor | Core Features | Strengths | Weaknesses |\n|---|---|---|---|\n| N/A | N/A | N/A | N/A |\n\n## Feasibility\n[Stub] High feasibility.\n\n## Key Insights\n- Placeholder insight`,
    manifest: {
      name: 'research.manifest.json',
      data: {
        competitors: ['competitor-a'],
        key_insights: ['placeholder-insight'],
        feasibility: 'high',
        risks: ['placeholder-risk'],
      },
    },
  },
  product_owner: {
    artifact: 'prd.md',
    content: `## Goal\n[Stub] Product goal placeholder.\n\n## Features\n- feature-1: Placeholder feature\n\n## Constraints\n- No placeholder constraints\n\n## Out of Scope\n- Placeholder exclusion`,
    manifest: {
      name: 'prd.manifest.json',
      data: {
        features: [{ id: 'F-001', name: 'feature-1' }],
        constraints: ['no-placeholder'],
        out_of_scope: ['placeholder-exclusion'],
      },
    },
  },
  ux_designer: {
    artifact: 'ux-flows.md',
    content: `## User Journeys\n### Flow 1: Main Flow\nStep 1 → Step 2 → Step 3\n\n## Interaction Rules\n- Placeholder rule\n\n## Component Inventory\n- MainComponent: placeholder`,
    manifest: {
      name: 'ux-flows.manifest.json',
      data: {
        flows: [{ name: 'main-flow', covers_features: ['F-001'] }],
        components: ['MainComponent'],
        interaction_rules: ['placeholder-rule'],
      },
    },
  },
  api_designer: {
    artifact: 'api-spec.yaml',
    content: `openapi: "3.0.0"\ninfo:\n  title: Stub API\n  version: "1.0.0"\npaths:\n  /api/placeholder:\n    get:\n      summary: Placeholder endpoint\n      responses:\n        "200":\n          description: OK`,
    manifest: {
      name: 'api-spec.manifest.json',
      data: {
        endpoints: [
          { method: 'GET', path: '/api/placeholder', covers_features: ['F-001'] },
        ],
        models: ['PlaceholderModel'],
      },
    },
  },
  ui_designer: {
    artifact: 'ui-plan.json',
    content: JSON.stringify({
      components: [
        { name: 'MainComponent', file: 'components/MainComponent.tsx', preview: 'previews/MainComponent.html', purpose: 'Main placeholder', covers_features: ['F-001'], parent: null, children: [], props: [], priority: 1 },
      ],
    }, null, 2),
    manifest: {
      name: 'components.manifest.json',
      data: {
        components: [
          { name: 'MainComponent', file: 'components/MainComponent.tsx', covers_features: ['F-001'] },
        ],
        screenshots: ['screenshots/MainComponent.png'],
        previews: ['previews/MainComponent.html'],
      },
    },
  },
  validator: {
    artifact: 'validation-report.md',
    content: `## Validation Summary\n- Status: PASS\n- Checks passed: 4/4\n\n## Detail\n### Check 1: PRD ↔ UX Flows Coverage\n- Status: PASS\n\n### Check 2: UX Flows ↔ API Coverage\n- Status: PASS\n\n### Check 3: API ↔ Components Coverage\n- Status: PASS\n\n### Check 4: Naming Consistency\n- Status: PASS`,
  },
};

export class StubAgent extends BaseAgent {
  async run(_context: AgentContext): Promise<void> {
    const def = STUB_OUTPUTS[this.stage];
    if (!def) {
      throw new Error(`No stub output defined for stage: ${this.stage}`);
    }
    this.writeOutput(def.artifact, def.content);
    if (def.manifest) {
      this.writeOutputManifest(def.manifest.name, def.manifest.data);
    }

    // UIDesigner also writes component tsx, preview HTML and screenshot placeholders
    if (this.stage === 'ui_designer') {
      this.writeOutput('components/MainComponent.tsx', 'export default function MainComponent() {\n  return <div className="p-4">Placeholder Component</div>;\n}');
      this.writeOutput('previews/MainComponent.html', '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div class="p-4">Placeholder Component</div></body></html>');
      this.writeOutput('screenshots/MainComponent.png', '[stub screenshot]');
    }
  }
}
