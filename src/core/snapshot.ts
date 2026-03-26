import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from './types.js';

const SNAPSHOTS_DIR = '.mosaic/snapshots';

export function createSnapshot(stage: StageName, runId: string, issueNumbers?: Record<string, number>, artifactsDir?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(SNAPSHOTS_DIR, `${timestamp}_${stage}`);
  const artifactsSnapshot = path.join(snapshotDir, 'artifacts');
  if (!artifactsDir) {
    throw new Error('artifactsDir is required for createSnapshot');
  }

  fs.mkdirSync(artifactsSnapshot, { recursive: true });

  // Copy all artifacts to snapshot
  if (fs.existsSync(artifactsDir)) {
    copyDirSync(artifactsDir, artifactsSnapshot);
  }

  // Write metadata
  const meta: Record<string, unknown> = {
    stage,
    runId,
    createdAt: new Date().toISOString(),
  };
  if (issueNumbers && Object.keys(issueNumbers).length > 0) {
    meta.issueNumbers = issueNumbers;
  }
  fs.writeFileSync(
    path.join(snapshotDir, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return snapshotDir;
}

/** Directories to skip when creating snapshots (same as git-publisher) */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.turbo', '.cache',
  '.next', '.nuxt', '.output', '__pycache__', '.venv', 'venv',
]);

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        fs.mkdirSync(destPath, { recursive: true });
        copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (err) {
      console.warn(`[snapshot] Failed to copy ${srcPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
