/**
 * Shared test helpers for mosaicat tests.
 *
 * Provides isolated temp directories so tests never touch
 * the project's real .mosaic/ directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setBaseDir, resetBaseDir } from '../core/artifact.js';

/**
 * Create an isolated temp directory for test artifacts.
 * Calls setBaseDir() so all artifact operations go to the temp dir.
 * Returns the temp root (parent of artifacts dir) for cleanup.
 */
export function createTestMosaicDir(): string {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-test-'));
  const artifactsDir = path.join(tmpRoot, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  setBaseDir(artifactsDir);
  return tmpRoot;
}

/**
 * Clean up a test's temp directory and reset artifact base dir.
 */
export function cleanupTestMosaicDir(tmpRoot: string): void {
  resetBaseDir();
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}
