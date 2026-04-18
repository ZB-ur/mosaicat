import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeManifest, readManifest } from '../manifest.js';
import type { PrdManifest, ResearchManifest } from '../manifest.js';
import { createTestArtifactStore } from '../../__tests__/test-helpers.js';
import type { ArtifactStore } from '../artifact-store.js';
import fs from 'node:fs';

describe('Manifest', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore();
  });

  afterEach(() => {
    if (store && fs.existsSync(store.runDir)) {
      fs.rmSync(store.runDir, { recursive: true, force: true });
    }
  });

  it('should write and read a valid prd manifest', () => {
    const data: PrdManifest = {
      features: [{ id: 'F-001', name: 'auth' }, { id: 'F-002', name: 'editor' }],
      constraints: ['no-third-party'],
      out_of_scope: ['payments'],
    };
    writeManifest(store, 'prd.manifest.json', data);
    const result = readManifest<PrdManifest>(store, 'prd.manifest.json');
    expect(result).toEqual(data);
  });

  it('should write and read a valid research manifest', () => {
    const data: ResearchManifest = {
      competitors: ['comp-a'],
      key_insights: ['insight-1'],
      feasibility: 'high',
      risks: ['risk-1'],
    };
    writeManifest(store, 'research.manifest.json', data);
    const result = readManifest<ResearchManifest>(store, 'research.manifest.json');
    expect(result).toEqual(data);
  });

  it('should reject invalid manifest data', () => {
    expect(() => {
      writeManifest(store, 'prd.manifest.json', { invalid: true });
    }).toThrow();
  });

  it('should throw on unregistered .manifest.json name', () => {
    expect(() => {
      writeManifest(store, 'unknown.manifest.json', { foo: 'bar' });
    }).toThrow('No Zod schema registered for manifest: unknown.manifest.json');
  });

  it('should NOT throw for names that do not end in .manifest.json', () => {
    expect(() => {
      writeManifest(store, 'config.json', { some: 'data' });
    }).not.toThrow();
  });

  it('should throw ZodError for registered name with invalid data', () => {
    expect(() => {
      writeManifest(store, 'research.manifest.json', { bad: 'data' });
    }).toThrow();
  });

  it('should throw on readManifest with unregistered .manifest.json name', () => {
    // Write a raw file first so store.read() succeeds
    store.write('unknown.manifest.json', '{}');
    expect(() => {
      readManifest(store, 'unknown.manifest.json');
    }).toThrow('No Zod schema registered for manifest: unknown.manifest.json');
  });
});
