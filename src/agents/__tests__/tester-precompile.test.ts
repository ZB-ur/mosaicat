import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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

function createTesterAgent(): TesterAgent {
  const mockProvider = { call: vi.fn() } as any;
  const mockLogger = {
    agent: vi.fn(),
    pipeline: vi.fn(),
  } as any;
  return new TesterAgent('tester', mockProvider, mockLogger);
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
  it('writes test-report.md with pre-compilation error info', async () => {
    const { writeArtifact } = await import('../../core/artifact.js');
    const { writeManifest } = await import('../../core/manifest.js');

    const agent = createTesterAgent() as any;
    agent.generatePreCompileFailureReport('error TS2304: Cannot find name "foo"');

    expect(writeArtifact).toHaveBeenCalledWith(
      'test-report.md',
      expect.stringContaining('Pre-compilation failed'),
    );
  });

  it('writes manifest with preCompilationFailed flag', async () => {
    const { writeManifest } = await import('../../core/manifest.js');

    const agent = createTesterAgent() as any;
    agent.generatePreCompileFailureReport('error TS2304');

    expect(writeManifest).toHaveBeenCalledWith(
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

    const context = {
      inputArtifacts: new Map([['test-plan.manifest.json', '{}']]),
      store: {},
      eventBus: { emit: vi.fn() },
    };

    await agent.run(context);

    // vitest should NOT be called (runTests should not be invoked)
    expect(agent.generatePreCompileFailureReport).toHaveBeenCalled();
  });
});
