import type { EventBus } from './event-bus.js';
import type { Logger } from './logger.js';
import type { LLMProvider } from './llm-provider.js';
import type { ContextManager } from './context-manager.js';
import type { StageName, Task, StageConfig, AgentContext } from './types.js';
import { writeArtifact } from './artifact.js';
import { writeManifest } from './manifest.js';

export interface AgentDeps {
  eventBus: EventBus;
  logger: Logger;
  llmProvider: LLMProvider;
  contextManager: ContextManager;
  projectRoot: string;
}

export abstract class BaseAgent {
  constructor(
    protected stage: StageName,
    protected deps: AgentDeps,
  ) {}

  async execute(task: Task, stageConfig: StageConfig): Promise<void> {
    const context = this.deps.contextManager.buildContext(
      this.stage,
      task,
      stageConfig,
    );

    this.deps.logger.agent(this.stage, 'info', 'execute:start', {
      inputArtifacts: context.inputArtifacts.map((a) => a.name),
    });

    // Core lifecycle: context → run → manifest → events
    const result = await this.run(context);

    // Write output artifacts
    for (const [name, content] of Object.entries(result.artifacts)) {
      if (name.endsWith('.manifest.json')) {
        writeManifest(name, JSON.parse(content), this.deps.projectRoot);
      } else {
        writeArtifact(name, content, this.deps.projectRoot);
      }
      this.deps.eventBus.emit('agent:artifact_produced', this.stage, name);
    }

    this.deps.logger.agent(this.stage, 'info', 'execute:complete', {
      outputArtifacts: Object.keys(result.artifacts),
    });
  }

  protected abstract run(context: AgentContext): Promise<AgentResult>;
}

export interface AgentResult {
  artifacts: Record<string, string>;
}

// --- Stub Agent for Phase 1 ---

export class StubAgent extends BaseAgent {
  protected async run(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();

    // Simulate LLM call
    const response = await this.deps.llmProvider.call({
      systemPrompt: context.systemPrompt,
      userPrompt: `Task: ${context.task.instruction}\n\nInput artifacts: ${context.inputArtifacts.map((a) => a.name).join(', ')}`,
    });

    this.deps.eventBus.emit('agent:llm_call', this.stage, Date.now() - startTime);

    // Generate stub artifacts based on agent config
    const artifacts: Record<string, string> = {};
    for (const output of context.agentConfig.output) {
      if (output.endsWith('/')) {
        // Directory output - create a placeholder file inside
        const dirName = output.replace('/', '');
        artifacts[`${dirName}/placeholder.txt`] = `[Stub] ${this.stage} output: ${dirName}/`;
      } else if (output.endsWith('.manifest.json')) {
        artifacts[output] = JSON.stringify(this.generateStubManifest(output), null, 2);
      } else {
        artifacts[output] = `# [Stub] ${this.stage}\n\n${response}\n`;
      }
    }

    return { artifacts };
  }

  private generateStubManifest(name: string): Record<string, unknown> {
    switch (name) {
      case 'research.manifest.json':
        return {
          competitors: ['competitor-a'],
          tech_stack_suggestions: ['react', 'typescript'],
          risks: ['stub-risk'],
          opportunities: ['stub-opportunity'],
        };
      case 'prd.manifest.json':
        return {
          features: ['feature-a', 'feature-b'],
          constraints: ['stub-constraint'],
          out_of_scope: ['stub-excluded'],
        };
      case 'ux-flows.manifest.json':
        return {
          flows: [
            { name: 'flow-a', covers_feature: 'feature-a', pages: ['/page-a'] },
            { name: 'flow-b', covers_feature: 'feature-b', pages: ['/page-b'] },
          ],
          components: ['ComponentA', 'ComponentB'],
          pages: ['/page-a', '/page-b'],
        };
      case 'api-spec.manifest.json':
        return {
          endpoints: [
            { method: 'GET', path: '/api/a', covers_feature: 'feature-a' },
            { method: 'POST', path: '/api/b', covers_feature: 'feature-b' },
          ],
          models: ['ModelA', 'ModelB'],
        };
      case 'components.manifest.json':
        return {
          components: [
            { name: 'ComponentA', file: 'components/ComponentA.tsx', consumes_models: ['ModelA'], covers_feature: 'feature-a' },
            { name: 'ComponentB', file: 'components/ComponentB.tsx', consumes_models: ['ModelB'], covers_feature: 'feature-b' },
          ],
          screenshots: ['screenshots/ComponentA.png', 'screenshots/ComponentB.png'],
        };
      default:
        return {};
    }
  }
}
