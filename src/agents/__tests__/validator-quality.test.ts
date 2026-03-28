import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock readManifest before importing the module under test
vi.mock('../../core/manifest.js', () => ({
  readManifest: vi.fn(),
}));

import { aggregateQualityGates } from '../validator.js';
import { readManifest } from '../../core/manifest.js';
import type { ArtifactStore } from '../../core/artifact-store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedReadManifest = readManifest as any as ReturnType<typeof vi.fn>;
const dummyStore = {} as ArtifactStore;

describe('aggregateQualityGates', () => {
  beforeEach(() => {
    mockedReadManifest.mockReset();
  });

  it('returns PASS when all manifests have quality_gate.blocked=false', () => {
    const qg = { stub_count: 0, partial_count: 0, complete_count: 5, coverage_gaps: [], blocked: false };
    mockedReadManifest.mockReturnValue({ quality_gate: qg });

    const result = aggregateQualityGates(dummyStore);
    expect(result.passed).toBe(true);
    expect(result.name).toBe('Check 9: Quality Gate Aggregation');
  });

  it('returns FAIL when any manifest has quality_gate.blocked=true', () => {
    const okGate = { stub_count: 0, partial_count: 0, complete_count: 5, coverage_gaps: [], blocked: false };
    const blockedGate = { stub_count: 3, partial_count: 1, complete_count: 2, coverage_gaps: [], blocked: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedReadManifest as any).mockImplementation((_store: unknown, name: unknown) => {
      if (name === 'code.manifest.json') return { quality_gate: blockedGate };
      return { quality_gate: okGate };
    });

    const result = aggregateQualityGates(dummyStore);
    expect(result.passed).toBe(false);
    const details = result.details as string[];
    expect(details.some(d => d.includes('BLOCKED'))).toBe(true);
  });

  it('aggregates stub_count + partial_count + complete_count across all manifests', () => {
    const gate1 = { stub_count: 1, partial_count: 2, complete_count: 3, coverage_gaps: [], blocked: false };
    const gate2 = { stub_count: 4, partial_count: 5, complete_count: 6, coverage_gaps: [], blocked: false };

    let callIndex = 0;
    mockedReadManifest.mockImplementation(() => {
      const gates = [gate1, gate2];
      const result = { quality_gate: gates[callIndex % 2] };
      callIndex++;
      return result;
    });

    const result = aggregateQualityGates(dummyStore);
    const details = result.details as string[];
    const summaryLine = details[0];
    // 11 manifests: alternating gate1 and gate2
    // gate1 used 6 times (indices 0,2,4,6,8,10), gate2 used 5 times (indices 1,3,5,7,9)
    const expectedStubs = 6 * 1 + 5 * 4;     // 26
    const expectedPartial = 6 * 2 + 5 * 5;   // 37
    const expectedComplete = 6 * 3 + 5 * 6;  // 48
    expect(summaryLine).toContain(`${expectedComplete} complete`);
    expect(summaryLine).toContain(`${expectedPartial} partial`);
    expect(summaryLine).toContain(`${expectedStubs} stubs`);
  });

  it('collects all coverage_gaps from all manifests (deduplicated)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedReadManifest as any).mockImplementation((_store: unknown, name: unknown) => {
      if (name === 'research.manifest.json') {
        return { quality_gate: { stub_count: 0, partial_count: 0, complete_count: 1, coverage_gaps: ['F-001', 'F-002'], blocked: false } };
      }
      if (name === 'prd.manifest.json') {
        return { quality_gate: { stub_count: 0, partial_count: 0, complete_count: 1, coverage_gaps: ['F-002', 'F-003'], blocked: false } };
      }
      // Others have no quality_gate
      return {};
    });

    const result = aggregateQualityGates(dummyStore);
    const details = result.details as string[];
    const gapsLine = details.find(d => d.includes('Coverage gaps'));
    expect(gapsLine).toBeDefined();
    expect(gapsLine).toContain('F-001');
    expect(gapsLine).toContain('F-002');
    expect(gapsLine).toContain('F-003');
  });

  it('gracefully handles missing manifests (empty store)', () => {
    mockedReadManifest.mockImplementation(() => {
      throw new Error('File not found');
    });

    const result = aggregateQualityGates(dummyStore);
    expect(result.passed).toBe(true);
    expect(result.details).toContain('No manifests with quality_gate data found');
  });

  it('gracefully handles manifests without quality_gate field (backward compat)', () => {
    // Manifests exist but have no quality_gate field
    mockedReadManifest.mockReturnValue({ features: [{ id: 'F-001', name: 'test' }] });

    const result = aggregateQualityGates(dummyStore);
    expect(result.passed).toBe(true);
    expect(result.details).toContain('No manifests with quality_gate data found');
  });

  it('includes stage name in BLOCKED detail line', () => {
    const blockedGate = { stub_count: 2, partial_count: 1, complete_count: 0, coverage_gaps: [], blocked: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedReadManifest as any).mockImplementation((_store: unknown, name: unknown) => {
      if (name === 'code.manifest.json') return { quality_gate: blockedGate };
      throw new Error('not found');
    });

    const result = aggregateQualityGates(dummyStore);
    expect(result.passed).toBe(false);
    const details = result.details as string[];
    expect(details.some(d => d.includes('code.manifest.json: BLOCKED'))).toBe(true);
    expect(details.some(d => d.includes('2 stubs'))).toBe(true);
  });
});
