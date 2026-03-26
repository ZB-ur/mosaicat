import fs from 'node:fs';

/**
 * List all files in a directory tree, returning paths relative to baseDir.
 * Skips node_modules and .git directories.
 */
export function listBuiltFiles(codeDir: string): string[] {
  const files: string[] = [];
  try {
    walkDir(codeDir, codeDir, files);
  } catch {
    // Directory may not exist yet
  }
  return files;
}

/**
 * Recursively walk a directory, collecting relative file paths.
 */
export function walkDir(dir: string, baseDir: string, result: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkDir(fullPath, baseDir, result);
    } else {
      result.push(fullPath.slice(baseDir.length + 1));
    }
  }
}
