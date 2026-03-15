import type { AgentContext, StageName } from './types.js';
import type { LLMProvider } from './llm-provider.js';
import type { Logger } from './logger.js';
import { writeArtifact } from './artifact.js';
import { writeManifest } from './manifest.js';

export abstract class BaseAgent {
  protected provider: LLMProvider;
  protected logger: Logger;
  readonly stage: StageName;

  constructor(stage: StageName, provider: LLMProvider, logger: Logger) {
    this.stage = stage;
    this.provider = provider;
    this.logger = logger;
  }

  async execute(context: AgentContext): Promise<void> {
    this.logger.agent(this.stage, 'info', 'agent:start', {
      inputs: Array.from(context.inputArtifacts.keys()),
    });

    try {
      await this.run(context);
      this.logger.agent(this.stage, 'info', 'agent:complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.agent(this.stage, 'error', 'agent:error', { error: message });
      throw err;
    }
  }

  protected abstract run(context: AgentContext): Promise<void>;

  protected writeOutput(name: string, content: string): void {
    writeArtifact(name, content);
    this.logger.agent(this.stage, 'info', 'artifact:written', { name });
  }

  protected writeOutputManifest(name: string, data: unknown): void {
    writeManifest(name, data);
    this.logger.agent(this.stage, 'info', 'manifest:written', { name });
  }
}

// --- Stub Agent for Phase 1 ---

interface StubOutputDef {
  artifact: string;
  content: string;
  manifest?: { name: string; data: unknown };
}

const STUB_OUTPUTS: Record<StageName, StubOutputDef> = {
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
        features: ['feature-1'],
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
        flows: ['main-flow'],
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
          { method: 'GET', path: '/api/placeholder', covers_feature: 'feature-1' },
        ],
        models: ['PlaceholderModel'],
      },
    },
  },
  ui_designer: {
    artifact: 'components/MainComponent.tsx',
    content: `export default function MainComponent() {\n  return <div className="p-4">Placeholder Component</div>;\n}`,
    manifest: {
      name: 'components.manifest.json',
      data: {
        components: [
          { name: 'MainComponent', file: 'components/MainComponent.tsx', covers_flow: 'main-flow' },
        ],
        screenshots: ['screenshots/MainComponent.png'],
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
    this.writeOutput(def.artifact, def.content);
    if (def.manifest) {
      this.writeOutputManifest(def.manifest.name, def.manifest.data);
    }

    // UIDesigner also writes a screenshot placeholder
    if (this.stage === 'ui_designer') {
      this.writeOutput('screenshots/MainComponent.png', '[stub screenshot]');
    }
  }
}
