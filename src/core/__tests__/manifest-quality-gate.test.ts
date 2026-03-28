import { describe, it, expect } from 'vitest';
import { analyzeFile, classifyFile } from '../hooks/ast-quality-gate.js';
import type { ImplementationStatus, QualityGate } from '../quality-gate-types.js';

/**
 * Tests for implementation_status classification that the Coder manifest
 * generation uses. Validates the AST analysis → classification → quality_gate
 * summary pipeline.
 */

describe('implementation_status for Coder manifest', () => {
  it('file with empty function body gets implementation_status: stub', () => {
    const code = `
export function fetchUsers(): User[] {
}
export function fetchPosts(): Post[] {
}
`;
    const analysis = analyzeFile('stub.ts', code);
    expect(classifyFile(analysis)).toBe('stub');
  });

  it('file with real implementation gets implementation_status: complete', () => {
    const code = `
export function fetchUsers(): User[] {
  const db = getDatabase();
  const rows = db.query('SELECT * FROM users');
  return rows.map(row => ({ id: row.id, name: row.name }));
}
export function formatUser(user: User): string {
  return \`\${user.name} (\${user.id})\`;
}
`;
    const analysis = analyzeFile('complete.ts', code);
    expect(classifyFile(analysis)).toBe('complete');
  });

  it('quality_gate counts are correct from file analyses', () => {
    const files = [
      { code: 'export function a() {}', name: 'a.ts' },
      { code: 'export function b() {}', name: 'b.ts' },
      { code: 'export function c() { return "real"; }', name: 'c.ts' },
      { code: 'export function d() { const x = "TODO: implement"; return x; }', name: 'd.ts' },
    ];

    const analyses = files.map(f => analyzeFile(f.name, f.code));
    const statuses = analyses.map(a => classifyFile(a));

    const statusCounts = { stub: 0, partial: 0, complete: 0 };
    for (const s of statuses) {
      statusCounts[s]++;
    }

    const qualityGate: QualityGate = {
      stub_count: statusCounts.stub,
      partial_count: statusCounts.partial,
      complete_count: statusCounts.complete,
      coverage_gaps: [],
      blocked: statusCounts.stub > 0 || statusCounts.partial > 0,
    };

    expect(qualityGate.stub_count).toBe(2);
    expect(qualityGate.partial_count).toBe(1);
    expect(qualityGate.complete_count).toBe(1);
    expect(qualityGate.blocked).toBe(true);
  });

  it('quality_gate.blocked is true when any file is stub or partial', () => {
    const analyses = [
      analyzeFile('partial.ts', 'export function x() { const msg = "TODO: fix"; return 42; }'),
      analyzeFile('complete.ts', 'export function y() { return 42; }'),
    ];

    const statuses = analyses.map(a => classifyFile(a));
    const counts = { stub: 0, partial: 0, complete: 0 };
    for (const s of statuses) counts[s]++;

    expect(counts.stub + counts.partial).toBeGreaterThan(0);
    expect(counts.stub > 0 || counts.partial > 0).toBe(true);
  });

  it('quality_gate.blocked is false when all files are complete', () => {
    const analyses = [
      analyzeFile('a.ts', 'export function x() { return 42; }'),
      analyzeFile('b.ts', 'export function y() { return "hello"; }'),
    ];

    const statuses = analyses.map(a => classifyFile(a));
    const counts = { stub: 0, partial: 0, complete: 0 };
    for (const s of statuses) counts[s]++;

    expect(counts.stub).toBe(0);
    expect(counts.partial).toBe(0);
    expect(counts.stub > 0 || counts.partial > 0).toBe(false);
  });

  it('generateManifest produces file entries with implementation_status field', () => {
    // Simulate what generateManifest does: analyze files and add status
    const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
    const files = [
      { path: 'code/index.ts', content: 'export function main() { console.log("hello"); }' },
      { path: 'code/utils.ts', content: 'export function helper() {}' },
      { path: 'code/config.json', content: '{"key": "value"}' },
    ];

    const fileEntries = files.map(f => {
      const ext = '.' + f.path.split('.').pop();
      let implementationStatus: ImplementationStatus | undefined;
      if (CODE_EXTENSIONS.has(ext)) {
        const analysis = analyzeFile(f.path, f.content);
        implementationStatus = classifyFile(analysis);
      }
      return {
        path: f.path,
        module: 'test',
        description: '',
        ...(implementationStatus !== undefined && { implementation_status: implementationStatus }),
      };
    });

    // index.ts should be complete
    expect(fileEntries[0].implementation_status).toBe('complete');
    // utils.ts should be stub (empty body)
    expect(fileEntries[1].implementation_status).toBe('stub');
    // config.json should have no implementation_status
    expect(fileEntries[2]).not.toHaveProperty('implementation_status');
  });
});
