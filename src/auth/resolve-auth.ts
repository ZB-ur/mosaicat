import { execSync } from 'node:child_process';
import { loadCachedAuth } from './auth-store.js';
import { listInstallations, getInstallationToken } from './token-service.js';
import type { AuthConfig, InstallationInfo } from './types.js';

/**
 * Resolve GitHub authentication via GitHub App mode.
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
      'Install at: https://github.com/apps/mosaicat'
    );
  }

  const match = matchRepo(installations);
  if (!match) {
    throw new Error(
      'Could not determine target repository.\n' +
      'Run this command inside a git repo with a GitHub remote, or ensure the App is installed on exactly one repo.'
    );
  }

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

interface RepoMatch {
  installation: InstallationInfo;
  owner: string;
  repo: string;
}

function matchRepo(installations: InstallationInfo[]): RepoMatch | null {
  // Collect all repos across all installations
  const allRepos: Array<{ installation: InstallationInfo; fullName: string; owner: string; repo: string }> = [];
  for (const inst of installations) {
    for (const r of inst.repositories) {
      const [owner, repo] = r.full_name.split('/');
      if (owner && repo) {
        allRepos.push({ installation: inst, fullName: r.full_name, owner, repo });
      }
    }
  }

  // Try to match via git remote
  const remoteSlug = detectGitRemoteSlug();
  if (remoteSlug) {
    const found = allRepos.find((r) => r.fullName === remoteSlug);
    if (found) return found;
  }

  // Single repo → auto-select
  if (allRepos.length === 1) {
    return allRepos[0];
  }

  // Multiple repos, no match
  return null;
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
