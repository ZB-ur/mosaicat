import path from 'node:path';
import { getArtifactsDir } from './artifact.js';

export interface ArtifactPresenter {
  /** Format a clickable link for a single artifact */
  formatLink(artifactName: string, size: number): string;
  /** Format a summary line listing multiple artifacts */
  formatSummary(artifacts: string[]): string;
}

/**
 * OSC 8 hyperlink for terminals that support it (iTerm2, VS Code, Cursor, etc).
 * Unsupported terminals display just the text — graceful degradation.
 */
function osc8Link(displayText: string, url: string): string {
  return `\x1b]8;;${url}\x1b\\${displayText}\x1b]8;;\x1b\\`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export class CLIArtifactPresenter implements ArtifactPresenter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir ?? getArtifactsDir());
  }

  formatLink(artifactName: string, size: number): string {
    const absPath = path.join(this.baseDir, artifactName);
    const linked = osc8Link(artifactName, `file://${absPath}`);
    return `${linked} (${formatBytes(size)})`;
  }

  formatSummary(artifacts: string[]): string {
    return artifacts
      .map((name) => {
        const absPath = path.join(this.baseDir, name);
        return osc8Link(name, `file://${absPath}`);
      })
      .join(', ');
  }
}

export class GitHubArtifactPresenter implements ArtifactPresenter {
  private owner: string;
  private repo: string;
  private branch: string;
  private artifactsPrefix: string;

  constructor(owner: string, repo: string, branch: string, artifactsPrefix?: string) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.artifactsPrefix = artifactsPrefix ?? getArtifactsDir();
  }

  formatLink(artifactName: string, size: number): string {
    const url = `https://github.com/${this.owner}/${this.repo}/blob/${this.branch}/${this.artifactsPrefix}/${artifactName}`;
    return `[${artifactName}](${url}) (${formatBytes(size)})`;
  }

  formatSummary(artifacts: string[]): string {
    return artifacts
      .map((name) => {
        const url = `https://github.com/${this.owner}/${this.repo}/blob/${this.branch}/${this.artifactsPrefix}/${name}`;
        return `[${name}](${url})`;
      })
      .join(', ');
  }
}
