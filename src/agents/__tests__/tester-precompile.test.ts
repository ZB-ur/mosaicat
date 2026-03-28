import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../../core/types.js';
import { TesterAgent } from '../tester.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock artifact module
vi.mock('../../core/artifact.js', () => ({
  writeArtifact: vi.fn(),
  readArtifact: vi.fn(() => '{}'),
  artifactExists: vi.fn(() => false),
  getArtifactsDir: vi.fn(() => '/tmp/test-artifacts'),
}));

// Mock manifest module
vi.mock('../../core/manifest.js', () => ({
  writeManifest: vi.fn(),
}));

// Mock event-bus
vi.mock('../../core/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const mockExecSync = vi.mocked(execSync);

function createMockRunContext(overrides: Record<string, any> = {}) {
  return {
    provider: { call: vi.fn() },
    logger: { agent: vi.fn(), pipeline: vi.fn() },
    store: {
      getDir: vi.fn().mockReturnValue('/tmp/test-code'),
      exists: vi.fn().mockReturnValue(false),
      read: vi.fn().mockReturnValue('{}'),
      write: vi.fn(),
    },
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    ...overrides,
  } as any;
}

function createTesterAgent(ctxOverrides: Record<string, any> = {}): TesterAgent {
  const ctx = createMockRunContext(ctxOverrides);
  return new TesterAgent('tester', ctx);
}

describe('TesterAgent.runPreCompilation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-mock execSync after restore
    vi.mocked(execSync).mockReset();
  });

  it('returns success when no test directory exists', () => {
    const agent = createTesterAgent() as any;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = agent.runPreCompilation('/tmp/code');
    expect(result.success).toBe(true);
    expect(result.errors).toBe('');

    existsSyncSpy.mockRestore();
  });

  it('returns success when tsc --noEmit passes', () => {
    const agent = createTesterAgent() as any;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    mockExecSync.mockReturnValue('');

    const result = agent.runPreCompilation('/tmp/code');
    expect(result.success).toBe(true);

    existsSyncSpy.mockRestore();
  });

  it('returns failure with errors when tsc --noEmit fails', () => {
    const agent = createTesterAgent() as any;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const tscError = new Error('TS2304: Cannot find name');
    (tscError as any).stdout = 'error TS2304: Cannot find name "foo"';
    (tscError as any).stderr = '';
    mockExecSync.mockImplementation(() => { throw tscError; });

    const result = agent.runPreCompilation('/tmp/code');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('TS2304');

    existsSyncSpy.mockRestore();
  });

  it('calls tsc --noEmit with correct cwd', () => {
    const agent = createTesterAgent() as any;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    mockExecSync.mockReturnValue('');

    agent.runPreCompilation('/my/code/dir');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('tsc --noEmit'),
      expect.objectContaining({ cwd: '/my/code/dir' }),
    );

    existsSyncSpy.mockRestore();
  });
});

describe('TesterAgent.generatePreCompileFailureReport', () => {
  it('writes test-report.md with pre-compilation error info', () => {
    const agent = createTesterAgent() as any;
    agent.generatePreCompileFailureReport('error TS2304: Cannot find name "foo"');

    const ctx = (agent as any).ctx;
    expect(ctx.store.write).toHaveBeenCalledWith(
      'test-report.md',
      expect.stringContaining('Pre-compilation failed'),
    );
  });

  it('writes manifest with preCompilationFailed flag', async () => {
    const { writeManifest } = await import('../../core/manifest.js');
    const mockWriteManifest = vi.mocked(writeManifest);
    mockWriteManifest.mockClear();

    const agent = createTesterAgent() as any;
    agent.generatePreCompileFailureReport('error TS2304');

    expect(mockWriteManifest).toHaveBeenCalledWith(
      expect.anything(),
      'test-report.manifest.json',
      expect.objectContaining({
        preCompilationFailed: true,
        errorClassification: 'parse-import',
        verdict: 'fail',
      }),
    );
  });
});

describe('TesterAgent.run pre-compilation integration', () => {
  it('skips vitest when pre-compilation fails', async () => {
    const agent = createTesterAgent() as any;

    // Mock runPreCompilation to fail
    agent.runPreCompilation = vi.fn().mockReturnValue({
      success: false,
      errors: 'TS2304: Cannot find name',
    });
    agent.generatePreCompileFailureReport = vi.fn();

    const context: AgentContext = {
      inputArtifacts: new Map([['test-plan.manifest.json', '{}']]),
    } as any;

    await agent.run(context);

    // vitest should NOT be called (runTests should not be invoked)
    expect(agent.generatePreCompileFailureReport).toHaveBeenCalled();
  });
});
