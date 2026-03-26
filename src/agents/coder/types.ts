import type { StageName } from '../../core/types.js';
import type { LLMProvider } from '../../core/llm-provider.js';
import type { Logger } from '../../core/logger.js';
import type { EventBus } from '../../core/event-bus.js';
import type { InteractionHandler } from '../../core/interaction-handler.js';

/**
 * Minimal artifact I/O interface for dependency injection.
 * Wraps the module-level functions from core/artifact.ts.
 */
export interface ArtifactIO {
  write(name: string, content: string): void;
  read(name: string): string;
  exists(name: string): boolean;
  getDir(): string;
}

/** Shared dependencies for Coder sub-modules (Planner, Builder). */
export interface CoderDeps {
  readonly stage: StageName;
  readonly provider: LLMProvider;
  readonly artifacts: ArtifactIO;
  readonly logger: Logger;
  readonly eventBus: EventBus;
}

/** Extended deps for BuildVerifier (needs interaction handler for user confirmation). */
export interface BuildVerifierDeps extends CoderDeps {
  readonly interactionHandler?: InteractionHandler;
}

/** Minimal deps for SmokeRunner (no LLM needed). */
export interface SmokeRunnerDeps {
  readonly stage: StageName;
  readonly artifacts: ArtifactIO;
  readonly logger: Logger;
  readonly eventBus: EventBus;
}
