import fs from 'node:fs';
import path from 'node:path';
import { getMosaicArtifactsDir } from './mosaic-home.js';

let baseDir: string | null = null;
let currentRunDir: string | null = null;

function resolveBaseDir(): string {
  return baseDir ?? getMosaicArtifactsDir();
}

function resolveRunDir(): string {
  return currentRunDir ?? resolveBaseDir();
}

/**
 * Override the base directory for artifacts (used by tests to avoid
 * touching the project's real .mosaic/ directory).
 */
export function setBaseDir(dir: string): void {
  baseDir = dir;
  currentRunDir = dir;
}

/**
 * Reset the base directory back to the default.
 */
export function resetBaseDir(): void {
  baseDir = null;
  currentRunDir = null;
}

/**
 * Initialize artifact directory for a specific run.
 * Must be called at the start of each pipeline run.
 */
export function initArtifactsDir(runId: string): string {
  currentRunDir = path.join(resolveBaseDir(), runId);
  fs.mkdirSync(currentRunDir, { recursive: true });
  return currentRunDir;
}

export function getArtifactsDir(): string {
  return resolveRunDir();
}

export function writeArtifact(name: string, content: string): void {
  const filePath = path.join(resolveRunDir(), name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function readArtifact(name: string): string {
  const filePath = path.join(resolveRunDir(), name);
  return fs.readFileSync(filePath, 'utf-8');
}

export function artifactExists(name: string): boolean {
  return fs.existsSync(path.join(resolveRunDir(), name));
}

/**
 * Find the most recent run directory in .mosaic/artifacts/.
 * Returns the run ID (directory name) or null if none found.
 */
export function findLatestRun(): string | null {
  const base = resolveBaseDir();
  if (!fs.existsSync(base)) return null;

  const entries = fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      mtime: fs.statSync(path.join(base, e.name)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return entries.length > 0 ? entries[0].name : null;
}

/**
 * Load all artifacts from a given run directory.
 * Returns a Map of relative artifact path → content.
 */
export function loadFromRun(runId: string): Map<string, string> {
  const runDir = path.join(resolveBaseDir(), runId);
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
