import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { BuildVerifier } from '../coder/build-verifier.js';
import type { BuildVerifierDeps } from '../coder/types.js';
import type { CodePlan } from '../code-plan-schema.js';
import {
  createTestArtifactStore,
  createMockProvider,
  createMockLogger,
} from '../../__tests__/test-helpers.js';
import { EventBus } from '../../core/event-bus.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

function makeDeps(overrides?: Partial<BuildVerifierDeps>): BuildVerifierDeps {
  return {
    stage: 'coder' as const,
    provider: createMockProvider(),
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

describe('BuildVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- runSetupCommand ---

  describe('runSetupCommand', () => {
    it('calls execSync with the plan setupCommand', () => {
      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      verifier.runSetupCommand(plan);

      expect(execSync).toHaveBeenCalledWith('npm install', expect.objectContaining({
        cwd: expect.stringContaining('/code'),
        stdio: 'pipe',
      }));
    });

    it('logs warning on failure but does not throw', () => {
      const mockExec = vi.mocked(execSync);
      mockExec.mockImplementation(() => { throw new Error('command not found'); });

      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      expect(() => verifier.runSetupCommand(plan)).not.toThrow();
      expect(deps.logger.agent).toHaveBeenCalledWith(
        'coder', 'warn', 'cmd:setup-failed', expect.any(Object),
      );
    });
  });

  // --- runVerifyCommand ---

  describe('runVerifyCommand', () => {
    it('returns { success: true } when execSync succeeds', () => {
      const mockExec = vi.mocked(execSync);
      mockExec.mockReturnValue(Buffer.from(''));

      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      const result = verifier.runVerifyCommand(plan);
      expect(result).toEqual({ success: true, errors: '' });
    });

    it('returns { success: false, errors } when execSync throws', () => {
      const err = new Error('tsc failed') as Error & { stdout?: Buffer; stderr?: Buffer };
      err.stdout = Buffer.from('');
      err.stderr = Buffer.from('error TS2304: Cannot find name');
      const mockExec = vi.mocked(execSync);
      mockExec.mockImplementation(() => { throw err; });

      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      const result = verifier.runVerifyCommand(plan);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Cannot find name');
    });
  });

  // --- runBuildCommand ---

  describe('runBuildCommand', () => {
    it('returns { success: true } when execSync succeeds', () => {
      const mockExec = vi.mocked(execSync);
      mockExec.mockReturnValue(Buffer.from(''));

      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      const result = verifier.runBuildCommand(plan);
      expect(result).toEqual({ success: true, errors: '' });
    });

    it('returns { success: false, errors } when execSync throws', () => {
      const err = new Error('build failed') as Error & { stdout?: Buffer; stderr?: Buffer };
      err.stdout = Buffer.from('');
      err.stderr = Buffer.from('Module not found');
      const mockExec = vi.mocked(execSync);
      mockExec.mockImplementation(() => { throw err; });

      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();

      const result = verifier.runBuildCommand(plan);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Module not found');
    });
  });

  // --- extractErrorFiles ---

  describe('extractErrorFiles', () => {
    it('parses TypeScript error format correctly', () => {
      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);

      const errors = 'src/foo.ts(10,5): error TS2304: Cannot find name\nsrc/bar.ts(3,1): error TS1005';
      const files = verifier.extractErrorFiles(errors);

      expect(files).toContain('src/foo.ts');
      expect(files).toContain('src/bar.ts');
      expect(files).toHaveLength(2);
    });
  });

  // --- askUserToRetry ---

  describe('askUserToRetry', () => {
    it('returns false when no interactionHandler provided', async () => {
      const deps = makeDeps(); // no interactionHandler
      const verifier = new BuildVerifier(deps);

      const result = await verifier.askUserToRetry('my-module', 3, 'some errors');
      expect(result).toBe(false);
    });
  });

  // --- runAcceptanceTests ---

  describe('runAcceptanceTests', () => {
    it('skips when acceptance tests directory does not exist', async () => {
      const deps = makeDeps();
      const verifier = new BuildVerifier(deps);
      const plan = makePlan();
      const context = { task: { runId: 'test-run' }, inputArtifacts: new Map() } as any;

      await verifier.runAcceptanceTests(context, plan, 1.0);

      expect(deps.logger.agent).toHaveBeenCalledWith(
        'coder', 'info', 'acceptance:skipped', expect.any(Object),
      );
    });
  });
});
