import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from './types.js';
import { getArtifactsDir } from './artifact.js';

const SNAPSHOTS_DIR = '.mosaic/snapshots';

export function createSnapshot(stage: StageName, runId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(SNAPSHOTS_DIR, `${timestamp}_${stage}`);
  const artifactsSnapshot = path.join(snapshotDir, 'artifacts');
  const artifactsDir = getArtifactsDir();

  fs.mkdirSync(artifactsSnapshot, { recursive: true });

  // Copy all artifacts to snapshot
  if (fs.existsSync(artifactsDir)) {
    copyDirSync(artifactsDir, artifactsSnapshot);
  }

  // Write metadata
  const meta = {
    stage,
    runId,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(snapshotDir, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return snapshotDir;
}

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
