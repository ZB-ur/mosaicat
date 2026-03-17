import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestDeviceCode,
  pollForAccessToken,
  fetchUserLogin,
  oauthDeviceFlow,
} from '../oauth-device-flow.js';

const mockFetch = vi.fn();
const noopSleep = () => Promise.resolve();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  };
}

describe('requestDeviceCode', () => {
  it('should request a device code', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }));

    const result = await requestDeviceCode('test-client-id');

    expect(result.device_code).toBe('dc_123');
    expect(result.user_code).toBe('ABCD-1234');
    expect(result.verification_uri).toBe('https://github.com/login/device');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test-client-id'),
      }),
    );
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(requestDeviceCode()).rejects.toThrow('Device code request failed: 401');
  });
});

describe('pollForAccessToken', () => {
  it('should return token when authorization completes', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'gho_abc123',
        token_type: 'bearer',
        scope: '',
      }));

    const result = await pollForAccessToken('dc_123', 0, 30, 'test-client-id', noopSleep);
    expect(result.access_token).toBe('gho_abc123');
  });

  it('should throw on access_denied', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'access_denied' }));
    await expect(pollForAccessToken('dc_123', 0, 30, undefined, noopSleep)).rejects.toThrow('denied by the user');
  });

  it('should throw on expired_token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'expired_token' }));
    await expect(pollForAccessToken('dc_123', 0, 30, undefined, noopSleep)).rejects.toThrow('expired');
  });

  it('should handle slow_down by continuing', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'gho_abc123',
        token_type: 'bearer',
        scope: '',
      }));

    const result = await pollForAccessToken('dc_123', 0, 30, undefined, noopSleep);
    expect(result.access_token).toBe('gho_abc123');
  });

  it('should throw on unknown error', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: 'server_error',
      error_description: 'Something went wrong',
    }));
    await expect(pollForAccessToken('dc_123', 0, 30, undefined, noopSleep)).rejects.toThrow('Unexpected OAuth error: server_error');
  });
});

describe('fetchUserLogin', () => {
  it('should return the user login', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ login: 'alice' }));

    const login = await fetchUserLogin('gho_abc123');
    expect(login).toBe('alice');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer gho_abc123',
        }),
      }),
    );
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(fetchUserLogin('bad-token')).rejects.toThrow('Failed to fetch user info: 401');
  });
});

describe('oauthDeviceFlow', () => {
  it('should run the full flow end to end', async () => {
    // 1. requestDeviceCode
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }));
    // 2. pollForAccessToken (immediate success)
    mockFetch.mockResolvedValueOnce(jsonResponse({
      access_token: 'gho_abc123',
      token_type: 'bearer',
      scope: '',
    }));
    // 3. fetchUserLogin
    mockFetch.mockResolvedValueOnce(jsonResponse({ login: 'alice' }));

    const onUserCode = vi.fn();
    const result = await oauthDeviceFlow({ onUserCode }, 'test-client-id', noopSleep);

    expect(onUserCode).toHaveBeenCalledWith('ABCD-1234', 'https://github.com/login/device');
    expect(result.accessToken).toBe('gho_abc123');
    expect(result.userLogin).toBe('alice');
  });
});
