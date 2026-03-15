import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StageName, PipelineRun } from './types.js';
import type { Logger } from './logger.js';
import { getArtifactsDir } from './artifact.js';

const DEFAULT_SNAPSHOTS_DIR = '.mosaic/snapshots';

export class SnapshotManager {
  constructor(
    private projectRoot: string,
    private logger: Logger,
  ) {}

  createSnapshot(stage: StageName, run: PipelineRun): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotDir = path.resolve(this.projectRoot, DEFAULT_SNAPSHOTS_DIR, timestamp);
    const artifactsCopy = path.join(snapshotDir, 'artifacts');

    fs.mkdirSync(artifactsCopy, { recursive: true });

    // Copy all current artifacts
    const artifactsDir = getArtifactsDir(this.projectRoot);
    if (fs.existsSync(artifactsDir)) {
      this.copyDir(artifactsDir, artifactsCopy);
    }

    // Write meta.json
    const meta = {
      stage,
      runId: run.id,
      timestamp: new Date().toISOString(),
      stageStatuses: Object.fromEntries(
        Object.entries(run.stages).map(([k, v]) => [k, v.status]),
      ),
    };
    fs.writeFileSync(path.join(snapshotDir, 'meta.json'), JSON.stringify(meta, null, 2));

    this.logger.pipeline('info', 'snapshot:created', { stage, path: snapshotDir });
    return snapshotDir;
  }

  restoreSnapshot(snapshotPath: string): void {
    // Phase 1 stub: just log the intent
    this.logger.pipeline('info', 'snapshot:restore_requested', { path: snapshotPath });
  }

  private copyDir(src: string, dest: string): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
