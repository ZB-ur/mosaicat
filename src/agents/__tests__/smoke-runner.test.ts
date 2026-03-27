import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { SmokeRunner } from '../coder/smoke-runner.js';
import type { SmokeRunnerDeps } from '../coder/types.js';
import type { CodePlan } from '../code-plan-schema.js';
import {
  createTestArtifactStore,
  createMockLogger,
} from '../../__tests__/test-helpers.js';
import { EventBus } from '../../core/event-bus.js';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

function makeDeps(overrides?: Partial<SmokeRunnerDeps>): SmokeRunnerDeps {
  return {
    stage: 'coder' as const,
    artifacts: createTestArtifactStore(),
    logger: createMockLogger(),
    eventBus: new EventBus(),
    ...overrides,
  };
}

function makePlan(overrides?: Partial<CodePlan>): CodePlan {
  return {
    project_name: 'test-project',
    tech_stack: { language: 'typescript', framework: 'react', build_tool: 'vite' },
    commands: {
      setupCommand: 'npm install',
      verifyCommand: 'npx tsc --noEmit',
      buildCommand: 'npm run build',
    },
    modules: [],
    ...overrides,
  };
}

function createMockProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe('SmokeRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- runSmokeTest ---

  describe('runSmokeTest', () => {
    it('skips when plan.smokeTest is undefined', async () => {
      const deps = makeDeps();
      const runner = new SmokeRunner(deps);
      const plan = makePlan(); // no smokeTest

      await runner.runSmokeTest(plan);

      expect(deps.logger.agent).toHaveBeenCalledWith(
        'coder', 'info', 'smoke:skipped', expect.objectContaining({ reason: 'no smokeTest config' }),
      );
      expect(spawn).not.toHaveBeenCalled();
    });

    it('skips for type "library"', async () => {
      const deps = makeDeps();
      const runner = new SmokeRunner(deps);
      const plan = makePlan({
        smokeTest: { type: 'library', startCommand: 'npm start' },
      });

      await runner.runSmokeTest(plan);

      expect(deps.logger.agent).toHaveBeenCalledWith(
        'coder', 'info', 'smoke:skipped', expect.objectContaining({ reason: 'type is library' }),
      );
      expect(spawn).not.toHaveBeenCalled();
    });

    it('skips for type "cli"', async () => {
      const deps = makeDeps();
      const runner = new SmokeRunner(deps);
      const plan = makePlan({
        smokeTest: { type: 'cli', startCommand: 'npm start' },
      });

      await runner.runSmokeTest(plan);

      expect(deps.logger.agent).toHaveBeenCalledWith(
        'coder', 'info', 'smoke:skipped', expect.objectContaining({ reason: 'type is cli' }),
      );
    });

    it('spawns process for type "web" with correct startCommand', async () => {
      const mockProc = createMockProcess();
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockReturnValue(mockProc as any);

      const deps = makeDeps();
      const runner = new SmokeRunner(deps);
      const plan = makePlan({
        smokeTest: { type: 'web', startCommand: 'npm run preview', port: 3000 },
      });

      // Make waitForPort timeout quickly
      const runPromise = runner.runSmokeTest(plan, 100);

      // Let it timeout
      await runPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['run', 'preview'],
        expect.objectContaining({
          cwd: expect.stringContaining('/code'),
          detached: true,
        }),
      );
    });

    it('kills spawned process in finally block', async () => {
      const mockProc = createMockProcess();
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockReturnValue(mockProc as any);

      const originalKill = process.kill;
      const mockKill = vi.fn();
      process.kill = mockKill as any;

      const deps = makeDeps();
      const runner = new SmokeRunner(deps);
      const plan = makePlan({
        smokeTest: { type: 'web', startCommand: 'npm start', port: 3000 },
      });

      await runner.runSmokeTest(plan, 100);

      // Should have tried to kill the process group
      expect(mockKill).toHaveBeenCalledWith(-12345, 'SIGTERM');

      process.kill = originalKill;
    });
  });

  // --- waitForPort ---

  describe('waitForPort', () => {
    it('resolves false on timeout', async () => {
      const deps = makeDeps();
      const runner = new SmokeRunner(deps);

      // Use a port that's unlikely to be open
      const result = await runner.waitForPort(59999, 200);
      expect(result).toBe(false);
    });
  });
});
