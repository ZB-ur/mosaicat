import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_CLIENT_ID: string;
}

export interface InstallationInfo {
  id: number;
  account: string;
  repositories: Array<{ full_name: string; name: string }>;
}

/**
 * Verify the user's OAuth token is valid and extract their login.
 */
export async function verifyUserToken(userToken: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mosaicat-backend',
    },
  });

  if (!res.ok) {
    throw new Error(`Invalid user token: ${res.status}`);
  }

  const data = await res.json() as { login: string };
  return data.login;
}

/**
 * List all installations of the GitHub App that the user has access to,
 * along with their repositories.
 */
export async function getUserInstallations(
  userToken: string,
  env: Env,
): Promise<InstallationInfo[]> {
  // Use the App auth to get an authenticated Octokit for the App itself
  const appAuth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  });

  // List installations accessible to the user via their token
  const res = await fetch('https://api.github.com/user/installations', {
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'mosaicat-backend',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to list user installations: ${res.status}`);
  }

  const data = await res.json() as {
    installations: Array<{
      id: number;
      account: { login: string } | null;
    }>;
  };

  // For each installation, fetch accessible repositories
  const results: InstallationInfo[] = [];

  for (const inst of data.installations) {
    const installationAuth = await appAuth({ type: 'installation', installationId: inst.id });

    const reposRes = await fetch(
      `https://api.github.com/installation/repositories?per_page=100`,
      {
        headers: {
          'Authorization': `token ${installationAuth.token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'mosaicat-backend',
        },
      },
    );

    if (!reposRes.ok) continue;

    const reposData = await reposRes.json() as {
      repositories: Array<{ full_name: string; name: string }>;
    };

    results.push({
      id: inst.id,
      account: inst.account?.login ?? '',
      repositories: reposData.repositories.map((r) => ({
        full_name: r.full_name,
        name: r.name,
      })),
    });
  }

  return results;
}

/**
 * Create an installation access token for the given installation.
 */
export async function createInstallationToken(
  installationId: number,
  env: Env,
): Promise<{ token: string; expires_at: string }> {
  const appAuth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  });

  const auth = await appAuth({
    type: 'installation',
    installationId,
  });

  return {
    token: auth.token,
    expires_at: auth.expiresAt ?? new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}
