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
