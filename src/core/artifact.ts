import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS_DIR = '.mosaic/artifacts';

export function getArtifactsDir(): string {
  return ARTIFACTS_DIR;
}

export function writeArtifact(name: string, content: string): void {
  const filePath = path.join(ARTIFACTS_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function readArtifact(name: string): string {
  const filePath = path.join(ARTIFACTS_DIR, name);
  return fs.readFileSync(filePath, 'utf-8');
}

export function artifactExists(name: string): boolean {
  return fs.existsSync(path.join(ARTIFACTS_DIR, name));
}
