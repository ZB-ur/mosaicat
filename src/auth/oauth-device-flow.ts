/**
 * GitHub OAuth Device Flow
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * Uses Node built-in fetch — no extra dependencies.
 */

// GitHub App client_id — public value, safe to hardcode
const DEFAULT_CLIENT_ID = 'Iv23liQwUyQJuhUhD46S';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface DeviceFlowCallbacks {
  onUserCode: (userCode: string, verificationUri: string) => void;
  onPolling?: () => void;
}

export async function requestDeviceCode(clientId?: string): Promise<DeviceCodeResponse> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId ?? DEFAULT_CLIENT_ID,
      scope: '',  // No scopes needed — we only use this to identify the user
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  clientId?: string,
  /** @internal Override sleep for testing */
  _sleep: (ms: number) => Promise<void> = sleep,
): Promise<OAuthTokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;
  const pollInterval = Math.max(interval, 5) * 1000; // GitHub requires minimum 5s

  while (Date.now() < deadline) {
    await _sleep(pollInterval);

    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId ?? DEFAULT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!res.ok) {
      throw new Error(`Token poll failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as Record<string, string>;

    if (data.access_token) {
      return {
        access_token: data.access_token,
        token_type: data.token_type ?? 'bearer',
        scope: data.scope ?? '',
      };
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      // GitHub asks us to increase interval by 5s
      await _sleep(5000);
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization was denied by the user.');
    }

    throw new Error(`Unexpected OAuth error: ${data.error} — ${data.error_description ?? ''}`);
  }

  throw new Error('Device code expired. Please try again.');
}

export async function fetchUserLogin(accessToken: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { login: string };
  return data.login;
}

/**
 * Run the full device flow: request code → prompt user → poll → fetch login.
 */
export async function oauthDeviceFlow(
  callbacks: DeviceFlowCallbacks,
  clientId?: string,
  /** @internal Override sleep for testing */
  _sleep?: (ms: number) => Promise<void>,
): Promise<{ accessToken: string; userLogin: string }> {
  const deviceCode = await requestDeviceCode(clientId);

  callbacks.onUserCode(deviceCode.user_code, deviceCode.verification_uri);

  const token = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
    clientId,
    _sleep,
  );

  const userLogin = await fetchUserLogin(token.access_token);

  return { accessToken: token.access_token, userLogin };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
