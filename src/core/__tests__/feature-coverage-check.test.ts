import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock manifest.ts before importing the hook
vi.mock('../manifest.js', () => ({
  readManifest: vi.fn(),
}));

import { createFeatureCoverageCheckHook } from '../hooks/feature-coverage-check.js';
import { readManifest } from '../manifest.js';
import { getHooksForStage } from '../hooks/index.js';
import type { AgentContext } from '../types.js';

const mockedReadManifest = vi.mocked(readManifest);

const dummyContext = {} as AgentContext;

describe('createFeatureCoverageCheckHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pass:true when all PRD features covered in manifest covers_features', async () => {
    mockedReadManifest.mockImplementation((name: string) => {
      if (name === 'prd.manifest.json') {
        return { features: [{ id: 'F-001', name: 'Login' }, { id: 'F-002', name: 'Signup' }], constraints: [], out_of_scope: [] };
      }
      if (name === 'code.manifest.json') {
        return { files: [], modules: [], covers_tasks: [], covers_features: ['F-001', 'F-002'] };
      }
      throw new Error(`Unknown manifest: ${name}`);
    });

    const hook = createFeatureCoverageCheckHook(
      'code.manifest.json',
      (data) => new Set((data as { covers_features: string[] }).covers_features),
    );

    const result = await hook.execute(dummyContext, '');
    expect(result.pass).toBe(true);
    expect(result.message).toContain('2 features covered');
  });

  it('returns pass:false with gap list when features missing from covers_features', async () => {
    mockedReadManifest.mockImplementation((name: string) => {
      if (name === 'prd.manifest.json') {
        return { features: [{ id: 'F-001', name: 'Login' }, { id: 'F-002', name: 'Signup' }, { id: 'F-003', name: 'Dashboard' }], constraints: [], out_of_scope: [] };
      }
      if (name === 'code.manifest.json') {
        return { files: [], modules: [], covers_tasks: [], covers_features: ['F-001'] };
      }
      throw new Error(`Unknown manifest: ${name}`);
    });

    const hook = createFeatureCoverageCheckHook(
      'code.manifest.json',
      (data) => new Set((data as { covers_features: string[] }).covers_features),
    );

    const result = await hook.execute(dummyContext, '');
    expect(result.pass).toBe(false);
    expect(result.message).toContain('F-002');
    expect(result.message).toContain('F-003');
    expect(result.message).toContain('2/3 features uncovered');
  });

  it('returns pass:true (skip) when prd.manifest.json does not exist', async () => {
    mockedReadManifest.mockImplementation((name: string) => {
      if (name === 'prd.manifest.json') {
        throw new Error('File not found');
      }
      return { files: [], modules: [], covers_tasks: [], covers_features: [] };
    });

    const hook = createFeatureCoverageCheckHook(
      'code.manifest.json',
      (data) => new Set((data as { covers_features: string[] }).covers_features),
    );

    const result = await hook.execute(dummyContext, '');
    expect(result.pass).toBe(true);
    expect(result.message).toContain('prd.manifest.json not available');
  });

  it('returns pass:true (skip) when target manifest does not exist', async () => {
    mockedReadManifest.mockImplementation((name: string) => {
      if (name === 'prd.manifest.json') {
        return { features: [{ id: 'F-001', name: 'Login' }], constraints: [], out_of_scope: [] };
      }
      throw new Error('File not found');
    });

    const hook = createFeatureCoverageCheckHook(
      'code.manifest.json',
      (data) => new Set((data as { covers_features: string[] }).covers_features),
    );

    const result = await hook.execute(dummyContext, '');
    expect(result.pass).toBe(true);
    expect(result.message).toContain('code.manifest.json not available');
  });
});

describe('getHooksForStage with new hooks', () => {
  it('coder stage returns hooks including ast-quality-gate (mandatory)', () => {
    const hooks = getHooksForStage('coder', '/tmp/test-artifacts');
    const astHook = hooks.postRun.find(h => h.name === 'ast-quality-gate');
    expect(astHook).toBeDefined();
    expect(astHook!.mandatory).toBe(true);
  });

  it('ui_designer stage returns hooks including ast-quality-gate (mandatory)', () => {
    const hooks = getHooksForStage('ui_designer', '/tmp/test-artifacts');
    const astHook = hooks.postRun.find(h => h.name === 'ast-quality-gate');
    expect(astHook).toBeDefined();
    expect(astHook!.mandatory).toBe(true);
  });

  it('coder stage returns hooks including feature-coverage-check', () => {
    const hooks = getHooksForStage('coder', '/tmp/test-artifacts');
    const coverageHook = hooks.postRun.find(h => h.name === 'feature-coverage-check');
    expect(coverageHook).toBeDefined();
    expect(coverageHook!.mandatory).toBe(false);
  });
});
