import type { InstallationInfo } from './types.js';

const DEFAULT_BACKEND_URL = 'https://mosaicat-backend.zhangbeifan.workers.dev';

function getBackendUrl(): string {
  return process.env.MOSAICAT_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

export async function listInstallations(userToken: string): Promise<InstallationInfo[]> {
  const res = await fetch(`${getBackendUrl()}/auth/installations`, {
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('OAuth token expired or invalid. Run `mosaicat login` again.');
    }
    throw new Error(`Failed to list installations: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<InstallationInfo[]>;
}

export interface InstallationTokenResult {
  token: string;
  expiresAt: string;
}

export async function getInstallationToken(
  installationId: number,
  userToken: string,
): Promise<InstallationTokenResult> {
  const res = await fetch(`${getBackendUrl()}/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ installation_id: installationId }),
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('GitHub App is not installed for this repository. Install at: https://github.com/apps/mosaicat');
    }
    throw new Error(`Failed to get installation token: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}
