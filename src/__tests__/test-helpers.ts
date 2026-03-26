/**
 * Shared test helpers for mosaicat tests.
 *
 * Provides isolated temp directories so tests never touch
 * the project's real .mosaic/ directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import type { LLMProvider, LLMResponse } from '../core/llm-provider.js';
import type { Logger } from '../core/logger.js';
import type { PipelineConfig } from '../core/types.js';
import { setBaseDir, resetBaseDir } from '../core/artifact.js';

/**
 * Create an isolated temp directory for test artifacts.
 * Calls setBaseDir() so all artifact operations go to the temp dir.
 * Returns the temp root (parent of artifacts dir) for cleanup.
 */
export function createTestMosaicDir(): string {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-test-'));
  const artifactsDir = path.join(tmpRoot, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  setBaseDir(artifactsDir);
  return tmpRoot;
}

/**
 * Clean up a test's temp directory and reset artifact base dir.
 */
export function cleanupTestMosaicDir(tmpRoot: string): void {
  resetBaseDir();
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// --- Typed Mock Factories ---

/**
 * Create a mock LLMProvider with optional overrides.
 * Default `call` returns a simple mock response.
 */
export function createMockProvider(
  overrides?: Partial<LLMProvider>,
): LLMProvider {
  const defaultCall = vi.fn().mockResolvedValue({
    content: '[mock] default response',
  } satisfies LLMResponse);

  return {
    call: overrides?.call ?? defaultCall,
  };
}

/**
 * Create a mock Logger that satisfies the Logger class interface
 * without touching the filesystem.
 *
 * Logger is a class with private fields; we mock only the public interface.
 * The `as unknown as Logger` cast is the ONE acceptable cast — it exists
 * because Logger is a class (not an interface) and has private fields
 * that cannot be satisfied by a plain object literal.
 */
export function createMockLogger(): Logger {
  return {
    pipeline: vi.fn(),
    agent: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    getLogDir: vi.fn().mockReturnValue('/tmp/mock-log-dir'),
  } as unknown as Logger;
}

/**
 * Create a test context with provider, logger, and pipeline config.
 * All fields have sensible defaults that can be overridden.
 */
export function createTestContext(overrides?: {
  provider?: LLMProvider;
  logger?: Logger;
  config?: Partial<PipelineConfig>;
}): { provider: LLMProvider; logger: Logger; config: PipelineConfig } {
  return {
    provider: overrides?.provider ?? createMockProvider(),
    logger: overrides?.logger ?? createMockLogger(),
    config: createTestPipelineConfig(overrides?.config),
  };
}

/**
 * Create a fully-typed PipelineConfig with sensible test defaults.
 */
export function createTestPipelineConfig(
  overrides?: Partial<PipelineConfig>,
): PipelineConfig {
  return {
    stages: {},
    pipeline: { max_retries_per_stage: 3, snapshot: 'on_stage_complete' },
    security: { initiator: 'test-user', reject_policy: 'silent' },
    github: {
      enabled: false,
      poll_interval_ms: 10000,
      poll_timeout_ms: 3600000,
      approve_keywords: ['/approve'],
      reject_keywords: ['/reject'],
    },
    ...overrides,
  };
}
