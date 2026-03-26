import { describe, it, expect } from 'vitest';
import { createRunContext } from '../run-context.js';
import { ArtifactStore } from '../artifact-store.js';
import { Logger } from '../logger.js';
import { StubProvider } from '../llm-provider.js';
import { EventBus } from '../event-bus.js';
import type { PipelineConfig } from '../types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeMinimalConfig(): PipelineConfig {
  return {
    stages: {},
    pipeline: { max_retries_per_stage: 3, snapshot: 'on' },
    security: { initiator: 'cli', reject_policy: 'block' },
    github: {
      enabled: false,
      poll_interval_ms: 5000,
      poll_timeout_ms: 300000,
      approve_keywords: ['approve'],
      reject_keywords: ['reject'],
    },
  };
}

describe('createRunContext', () => {
  it('returns RunContext with all fields accessible', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-'));
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-log-'));

    try {
      const store = new ArtifactStore(tmpDir, 'test-run');
      const logger = new Logger('test-run', logDir);
      const provider = new StubProvider();
      const bus = new EventBus();
      const config = makeMinimalConfig();
      const controller = new AbortController();

      const ctx = createRunContext({
        store,
        logger,
        provider,
        eventBus: bus,
        config,
        signal: controller.signal,
        devMode: true,
      });

      expect(ctx.store).toBe(store);
      expect(ctx.logger).toBe(logger);
      expect(ctx.provider).toBe(provider);
      expect(ctx.eventBus).toBe(bus);
      expect(ctx.devMode).toBe(true);
      expect(ctx.signal).toBe(controller.signal);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('defaults devMode to false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-'));
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-log-'));

    try {
      const store = new ArtifactStore(tmpDir, 'test-run');
      const logger = new Logger('test-run', logDir);
      const provider = new StubProvider();
      const bus = new EventBus();

      const ctx = createRunContext({
        store,
        logger,
        provider,
        eventBus: bus,
        config: makeMinimalConfig(),
      });

      expect(ctx.devMode).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('provides a default signal when none given', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-'));
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-log-'));

    try {
      const store = new ArtifactStore(tmpDir, 'test-run');
      const logger = new Logger('test-run', logDir);
      const provider = new StubProvider();
      const bus = new EventBus();

      const ctx = createRunContext({
        store,
        logger,
        provider,
        eventBus: bus,
        config: makeMinimalConfig(),
      });

      expect(ctx.signal).toBeDefined();
      expect(ctx.signal.aborted).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('freezes the config so mutations throw', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-'));
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ctx-log-'));

    try {
      const store = new ArtifactStore(tmpDir, 'test-run');
      const logger = new Logger('test-run', logDir);
      const provider = new StubProvider();
      const bus = new EventBus();

      const ctx = createRunContext({
        store,
        logger,
        provider,
        eventBus: bus,
        config: makeMinimalConfig(),
      });

      expect(() => {
        (ctx.config as Record<string, unknown>).pipeline = {};
      }).toThrow(TypeError);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});
