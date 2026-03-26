import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from '../artifact-store.js';

describe('ArtifactStore', () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-store-test-'));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('creates runDir if it does not exist', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      expect(fs.existsSync(store.getDir())).toBe(true);
    });

    it('sets runDir to baseDir/runId', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      expect(store.getDir()).toBe(path.join(base, 'run-001'));
    });
  });

  describe('write and read', () => {
    it('writes and reads a file', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      store.write('test.md', 'hello world');
      expect(store.read('test.md')).toBe('hello world');
    });

    it('creates intermediate directories for nested paths', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      store.write('sub/dir/test.md', 'nested content');
      expect(store.read('sub/dir/test.md')).toBe('nested content');
    });
  });

  describe('read errors', () => {
    it('throws ENOENT for missing files', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      expect(() => store.read('missing.md')).toThrow();
    });
  });

  describe('exists', () => {
    it('returns true after write', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      store.write('test.md', 'content');
      expect(store.exists('test.md')).toBe(true);
    });

    it('returns false for non-existent files', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      expect(store.exists('nope.md')).toBe(false);
    });
  });

  describe('getDir', () => {
    it('returns the run directory path', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      expect(store.getDir()).toBe(path.join(base, 'run-001'));
    });
  });

  describe('static findLatestRun', () => {
    it('returns null when no runs exist', () => {
      const base = makeTmpDir();
      expect(ArtifactStore.findLatestRun(base)).toBeNull();
    });

    it('returns most recent run ID', async () => {
      const base = makeTmpDir();
      // Create two run dirs with explicit time separation
      const oldDir = path.join(base, 'run-old');
      const newDir = path.join(base, 'run-new');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(newDir, { recursive: true });
      // Set run-old to 10 seconds ago, run-new to now
      const past = new Date(Date.now() - 10000);
      const now = new Date();
      fs.utimesSync(oldDir, past, past);
      fs.utimesSync(newDir, now, now);

      expect(ArtifactStore.findLatestRun(base)).toBe('run-new');
    });

    it('returns null when baseDir does not exist', () => {
      expect(ArtifactStore.findLatestRun('/nonexistent-path-xyz')).toBeNull();
    });
  });

  describe('static loadFromRun', () => {
    it('returns Map of artifact paths to contents', () => {
      const base = makeTmpDir();
      const store = new ArtifactStore(base, 'run-001');
      store.write('prd.md', 'Product Requirements');
      store.write('api-spec.yaml', 'openapi: 3.0');

      const artifacts = ArtifactStore.loadFromRun(base, 'run-001');
      expect(artifacts.get('prd.md')).toBe('Product Requirements');
      expect(artifacts.get('api-spec.yaml')).toBe('openapi: 3.0');
    });

    it('returns empty Map for non-existent run', () => {
      const base = makeTmpDir();
      const artifacts = ArtifactStore.loadFromRun(base, 'no-such-run');
      expect(artifacts.size).toBe(0);
    });
  });
});
