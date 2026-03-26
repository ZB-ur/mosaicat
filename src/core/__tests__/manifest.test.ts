import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeManifest, readManifest } from '../manifest.js';
import type { PrdManifest, ResearchManifest } from '../manifest.js';
import { createTestMosaicDir, cleanupTestMosaicDir } from '../../__tests__/test-helpers.js';
import { initArtifactsDir } from '../artifact.js';

describe('Manifest', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = createTestMosaicDir();
    initArtifactsDir('test-run');
  });

  afterEach(() => {
    cleanupTestMosaicDir(tmpRoot);
  });

  it('should write and read a valid prd manifest', () => {
    const data: PrdManifest = {
      features: [{ id: 'F-001', name: 'auth' }, { id: 'F-002', name: 'editor' }],
      constraints: ['no-third-party'],
      out_of_scope: ['payments'],
    };
    writeManifest('prd.manifest.json', data);
    const result = readManifest<PrdManifest>('prd.manifest.json');
    expect(result).toEqual(data);
  });

  it('should write and read a valid research manifest', () => {
    const data: ResearchManifest = {
      competitors: ['comp-a'],
      key_insights: ['insight-1'],
      feasibility: 'high',
      risks: ['risk-1'],
    };
    writeManifest('research.manifest.json', data);
    const result = readManifest<ResearchManifest>('research.manifest.json');
    expect(result).toEqual(data);
  });

  it('should reject invalid manifest data', () => {
    expect(() => {
      writeManifest('prd.manifest.json', { invalid: true });
    }).toThrow();
  });
});
