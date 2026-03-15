import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_ARTIFACTS_DIR = '.mosaic/artifacts';

export function getArtifactsDir(baseDir?: string): string {
  return path.resolve(baseDir ?? '.', DEFAULT_ARTIFACTS_DIR);
}

export function writeArtifact(name: string, content: string, baseDir?: string): string {
  const dir = getArtifactsDir(baseDir);
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function readArtifact(name: string, baseDir?: string): string {
  const filePath = path.join(getArtifactsDir(baseDir), name);
  return fs.readFileSync(filePath, 'utf-8');
}

export function artifactExists(name: string, baseDir?: string): boolean {
  const filePath = path.join(getArtifactsDir(baseDir), name);
  return fs.existsSync(filePath);
}

export function listArtifacts(baseDir?: string): string[] {
  const dir = getArtifactsDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .map((f) => (typeof f === 'string' ? f : f.toString()))
    .filter((f) => !fs.statSync(path.join(dir, f)).isDirectory());
}
