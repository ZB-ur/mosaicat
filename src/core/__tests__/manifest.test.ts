import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { writeManifest, readManifest } from '../manifest.js';
import type { PrdManifest, ResearchManifest } from '../manifest.js';

describe('Manifest', () => {
  beforeEach(() => {
    fs.mkdirSync('.mosaic/artifacts', { recursive: true });
  });

  afterEach(() => {
    fs.rmSync('.mosaic', { recursive: true, force: true });
  });

  it('should write and read a valid prd manifest', () => {
    const data: PrdManifest = {
      features: ['auth', 'editor'],
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
