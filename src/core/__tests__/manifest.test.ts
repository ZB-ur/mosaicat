import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeManifest, readManifest, getAllManifests } from '../manifest.js';

describe('Manifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaicat-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write and read a valid prd manifest', () => {
    const data = {
      features: ['auth', 'editor'],
      constraints: ['no-third-party'],
      out_of_scope: ['payment'],
    };

    writeManifest('prd.manifest.json', data, tmpDir);
    const result = readManifest('prd.manifest.json', tmpDir);
    expect(result).toEqual(data);
  });

  it('should reject invalid manifest data', () => {
    const invalid = {
      features: 'not-an-array', // should be array
      constraints: [],
      out_of_scope: [],
    };

    expect(() => writeManifest('prd.manifest.json', invalid, tmpDir)).toThrow();
  });

  it('should write and read research manifest', () => {
    const data = {
      competitors: ['comp-a'],
      tech_stack_suggestions: ['react'],
      risks: ['risk-1'],
      opportunities: ['opp-1'],
    };

    writeManifest('research.manifest.json', data, tmpDir);
    const result = readManifest('research.manifest.json', tmpDir);
    expect(result).toEqual(data);
  });

  it('should get all manifests', () => {
    writeManifest('prd.manifest.json', {
      features: ['f1'],
      constraints: [],
      out_of_scope: [],
    }, tmpDir);
    writeManifest('research.manifest.json', {
      competitors: [],
      tech_stack_suggestions: [],
      risks: [],
      opportunities: [],
    }, tmpDir);

    const all = getAllManifests(tmpDir);
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['prd.manifest.json']).toBeDefined();
    expect(all['research.manifest.json']).toBeDefined();
  });
});
