import fs from 'node:fs';
import path from 'node:path';

/**
 * Instance-based artifact storage scoped to a single pipeline run.
 * Replaces the global mutable state in artifact.ts with per-run isolation.
 */
export class ArtifactStore {
  readonly runDir: string;

  constructor(baseDir: string, runId: string) {
    this.runDir = path.join(baseDir, runId);
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  /** Write an artifact file. Creates intermediate directories as needed. */
  write(name: string, content: string): void {
    const filePath = path.join(this.runDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /** Read an artifact file. Throws ENOENT if not found. */
  read(name: string): string {
    const filePath = path.join(this.runDir, name);
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** Check whether an artifact file exists. */
  exists(name: string): boolean {
    return fs.existsSync(path.join(this.runDir, name));
  }

  /** Return the run directory path. */
  getDir(): string {
    return this.runDir;
  }

  /**
   * Find the most recent run directory under baseDir.
   * Returns the run ID (directory name) or null if none found.
   */
  static findLatestRun(baseDir: string): string | null {
    if (!fs.existsSync(baseDir)) return null;

    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({
        name: e.name,
        mtime: fs.statSync(path.join(baseDir, e.name)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return entries.length > 0 ? entries[0].name : null;
  }

  /**
   * Load all artifacts from a given run directory.
   * Returns a Map of relative artifact path to content.
   */
  static loadFromRun(baseDir: string, runId: string): Map<string, string> {
    const runDir = path.join(baseDir, runId);
    const artifacts = new Map<string, string>();

    if (!fs.existsSync(runDir)) return artifacts;

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(fullPath);
        } else {
          const relativePath = path.relative(runDir, fullPath);
          try {
            artifacts.set(relativePath, fs.readFileSync(fullPath, 'utf-8'));
          } catch {
            // Skip binary or unreadable files
          }
        }
      }
    };

    walk(runDir);
    return artifacts;
  }
}
