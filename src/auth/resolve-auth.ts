import { execSync } from 'node:child_process';
import { select } from '@inquirer/prompts';
import { loadCachedAuth } from './auth-store.js';
import { listInstallations, getInstallationToken } from './token-service.js';
import type { AuthConfig, InstallationInfo } from './types.js';

/**
 * Resolve GitHub authentication via GitHub App mode.
 * Interactive: prompts user to select repo when multiple are available.
 * Requires: `mosaicat login` + GitHub App installed on target repo.
 */
export async function resolveGitHubAuth(): Promise<AuthConfig> {
  const cached = loadCachedAuth();
  if (!cached) {
    throw new Error(
      'Not logged in. Run `mosaicat login` first.'
    );
  }

  const installations = await listInstallations(cached.userToken);
  if (installations.length === 0) {
    throw new Error(
      'GitHub App is not installed on any repository.\n' +
      'Install at: https://github.com/apps/mosaicatie'
    );
  }

  // Collect all repos across all installations
  const allRepos = collectRepos(installations);
  if (allRepos.length === 0) {
    throw new Error(
      'GitHub App is installed but no accessible repositories found.\n' +
      'Check App permissions at: https://github.com/apps/mosaicatie'
    );
  }

  // Resolve which repo to use
  const match = await resolveRepo(allRepos);
  const { installation, owner, repo } = match;

  const tokenResult = await getInstallationToken(installation.id, cached.userToken);

  return {
    userLogin: cached.userLogin,
    owner,
    repo,
    installationToken: tokenResult.token,
    installationTokenExpiresAt: tokenResult.expiresAt,
  };
}

interface RepoEntry {
  installation: InstallationInfo;
  fullName: string;
  owner: string;
  repo: string;
}

function collectRepos(installations: InstallationInfo[]): RepoEntry[] {
  const allRepos: RepoEntry[] = [];
  for (const inst of installations) {
    for (const r of inst.repositories) {
      const [owner, repo] = r.full_name.split('/');
      if (owner && repo) {
        allRepos.push({ installation: inst, fullName: r.full_name, owner, repo });
      }
    }
  }
  return allRepos;
}

async function resolveRepo(allRepos: RepoEntry[]): Promise<RepoEntry> {
  // Single repo → auto-select, no ambiguity
  if (allRepos.length === 1) {
    return allRepos[0];
  }

  // Multiple repos — try git remote match as default, but always let user confirm/switch
  const remoteSlug = detectGitRemoteSlug();
  const remoteMatch = remoteSlug ? allRepos.find((r) => r.fullName === remoteSlug) : null;

  // Build choices with remote match as default
  const choices = allRepos.map(r => ({
    name: r.fullName === remoteMatch?.fullName ? `${r.fullName} (当前仓库)` : r.fullName,
    value: r,
  }));

  const chosen = await select({
    message: '选择目标仓库:',
    choices,
    default: remoteMatch ?? undefined,
  });

  process.stdout.write(`\x1b[32m✓ 已选择: ${chosen.fullName}\x1b[0m\n`);
  return chosen;
}

/**
 * Try to detect owner/repo from the current git remote (origin).
 * Returns null if not in a git repo or no GitHub remote found.
 */
export function detectGitRemoteSlug(): string | null {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return parseGitHubUrl(url);
  } catch {
    return null;
  }
}

export function parseGitHubUrl(url: string): string | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;

  return null;
}
