import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listInstallations, getInstallationToken } from '../token-service.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  delete process.env.MOSAICAT_BACKEND_URL;
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

describe('listInstallations', () => {
  it('should return installations from backend', async () => {
    const installations = [
      { id: 1, account: 'alice', repositories: [{ full_name: 'alice/repo1', name: 'repo1' }] },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(installations));

    const result = await listInstallations('gho_user_token');

    expect(result).toEqual(installations);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.mosaicat.dev/auth/installations',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer gho_user_token',
        }),
      }),
    );
  });

  it('should throw on 401 with login guidance', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(listInstallations('bad-token')).rejects.toThrow('Run `mosaicat login` again');
  });

  it('should throw on other errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(listInstallations('token')).rejects.toThrow('Failed to list installations: 500');
  });

  it('should use MOSAICAT_BACKEND_URL if set', async () => {
    process.env.MOSAICAT_BACKEND_URL = 'http://localhost:8787';
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await listInstallations('token');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/auth/installations',
      expect.anything(),
    );
  });
});

describe('getInstallationToken', () => {
  it('should return token from backend', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      token: 'ghs_install_token',
      expires_at: '2026-03-17T21:00:00Z',
    }));

    const result = await getInstallationToken(42, 'gho_user_token');

    expect(result).toEqual({
      token: 'ghs_install_token',
      expiresAt: '2026-03-17T21:00:00Z',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.mosaicat.dev/auth/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ installation_id: 42 }),
      }),
    );
  });

  it('should throw on 404 with install guidance', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(getInstallationToken(42, 'token')).rejects.toThrow('not installed');
  });

  it('should throw on other errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(getInstallationToken(42, 'token')).rejects.toThrow('Failed to get installation token: 500');
  });
});
