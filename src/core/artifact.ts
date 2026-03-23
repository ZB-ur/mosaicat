import fs from 'node:fs';
import path from 'node:path';

const BASE_DIR = '.mosaic/artifacts';
let currentRunDir: string = BASE_DIR;

/**
 * Initialize artifact directory for a specific run.
 * Must be called at the start of each pipeline run.
 */
export function initArtifactsDir(runId: string): string {
  currentRunDir = path.join(BASE_DIR, runId);
  fs.mkdirSync(currentRunDir, { recursive: true });
  return currentRunDir;
}

export function getArtifactsDir(): string {
  return currentRunDir;
}

export function writeArtifact(name: string, content: string): void {
  const filePath = path.join(currentRunDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function readArtifact(name: string): string {
  const filePath = path.join(currentRunDir, name);
  return fs.readFileSync(filePath, 'utf-8');
}

export function artifactExists(name: string): boolean {
  return fs.existsSync(path.join(currentRunDir, name));
}

/**
 * Find the most recent run directory in .mosaic/artifacts/.
 * Returns the run ID (directory name) or null if none found.
 */
export function findLatestRun(): string | null {
  if (!fs.existsSync(BASE_DIR)) return null;

  const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      mtime: fs.statSync(path.join(BASE_DIR, e.name)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? entries[0].name : null;
}

/**
 * Load all artifacts from a given run directory.
 * Returns a Map of relative artifact path → content.
 */
export function loadFromRun(runId: string): Map<string, string> {
  const runDir = path.join(BASE_DIR, runId);
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
