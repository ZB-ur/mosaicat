import type { ArtifactStore } from './artifact-store.js';
import type { Logger } from './logger.js';
import type { LLMProvider } from './llm-provider.js';
import type { EventBus } from './event-bus.js';
import type { PipelineConfig } from './types.js';

/**
 * Immutable context bundle passed to every agent and subsystem during a pipeline run.
 * Replaces scattered global state with a single, typed dependency container.
 */
export interface RunContext {
  readonly store: ArtifactStore;
  readonly logger: Logger;
  readonly provider: LLMProvider;
  readonly eventBus: EventBus;
  readonly config: Readonly<PipelineConfig>;
  readonly signal: AbortSignal;
  readonly devMode: boolean;
}

/** Recursively freeze an object and all nested objects/arrays. */
function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val as object);
    }
  }
  return obj;
}

/**
 * Create a deeply frozen clone of a PipelineConfig.
 * Uses structuredClone to avoid mutating the original, then deep-freezes the clone.
 */
export function freezeConfig(raw: PipelineConfig): Readonly<PipelineConfig> {
  const clone = structuredClone(raw);
  return deepFreeze(clone);
}

/**
 * Create a RunContext from its constituent dependencies.
 * Freezes the config and provides defaults for optional fields.
 */
export function createRunContext(deps: {
  store: ArtifactStore;
  logger: Logger;
  provider: LLMProvider;
  eventBus: EventBus;
  config: PipelineConfig;
  signal?: AbortSignal;
  devMode?: boolean;
}): RunContext {
  const controller = new AbortController();
  return {
    store: deps.store,
    logger: deps.logger,
    provider: deps.provider,
    eventBus: deps.eventBus,
    config: freezeConfig(deps.config),
    signal: deps.signal ?? controller.signal,
    devMode: deps.devMode ?? false,
  };
}
