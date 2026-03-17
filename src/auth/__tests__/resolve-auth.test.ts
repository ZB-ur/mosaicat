import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth-store.js', () => ({
  loadCachedAuth: vi.fn(),
}));

vi.mock('../token-service.js', () => ({
  listInstallations: vi.fn(),
  getInstallationToken: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { resolveGitHubAuth, parseGitHubUrl } from '../resolve-auth.js';
import { loadCachedAuth } from '../auth-store.js';
import { listInstallations, getInstallationToken } from '../token-service.js';
import { execSync } from 'node:child_process';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('resolveGitHubAuth', () => {
  describe('legacy token mode', () => {
    it('should resolve from env vars when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      process.env.MOSAIC_GITHUB_REPO = 'alice/repo1';
      process.env.MOSAIC_INITIATOR_LOGIN = 'alice';

      const config = await resolveGitHubAuth();

      expect(config).toEqual({
        mode: 'token',
        userLogin: 'alice',
        owner: 'alice',
        repo: 'repo1',
        personalToken: 'ghp_test',
      });
    });

    it('should throw if MOSAIC_GITHUB_REPO is missing', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      delete process.env.MOSAIC_GITHUB_REPO;
      delete process.env.MOSAIC_INITIATOR_LOGIN;

      await expect(resolveGitHubAuth()).rejects.toThrow('MOSAIC_GITHUB_REPO');
    });

    it('should throw if MOSAIC_INITIATOR_LOGIN is missing', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      process.env.MOSAIC_GITHUB_REPO = 'alice/repo1';
      delete process.env.MOSAIC_INITIATOR_LOGIN;

      await expect(resolveGitHubAuth()).rejects.toThrow('MOSAIC_INITIATOR_LOGIN');
    });

    it('should throw on invalid repo format', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      process.env.MOSAIC_GITHUB_REPO = 'invalid';
      process.env.MOSAIC_INITIATOR_LOGIN = 'alice';

      await expect(resolveGitHubAuth()).rejects.toThrow('format: owner/repo');
    });
  });

  describe('app mode', () => {
    beforeEach(() => {
      delete process.env.GITHUB_TOKEN;
    });

    it('should throw if not logged in', async () => {
      vi.mocked(loadCachedAuth).mockReturnValue(null);

      await expect(resolveGitHubAuth()).rejects.toThrow('mosaicat login');
    });

    it('should throw if no installations', async () => {
      vi.mocked(loadCachedAuth).mockReturnValue({ userToken: 'gho_test', userLogin: 'alice' });
      vi.mocked(listInstallations).mockResolvedValue([]);

      await expect(resolveGitHubAuth()).rejects.toThrow('not installed');
    });

    it('should auto-select single repo', async () => {
      vi.mocked(loadCachedAuth).mockReturnValue({ userToken: 'gho_test', userLogin: 'alice' });
      vi.mocked(listInstallations).mockResolvedValue([
        { id: 42, account: 'alice', repositories: [{ full_name: 'alice/my-app', name: 'my-app' }] },
      ]);
      vi.mocked(getInstallationToken).mockResolvedValue({
        token: 'ghs_bot_token',
        expiresAt: '2026-03-17T21:00:00Z',
      });
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not a git repo'); });

      const config = await resolveGitHubAuth();

      expect(config).toEqual({
        mode: 'app',
        userLogin: 'alice',
        owner: 'alice',
        repo: 'my-app',
        installationToken: 'ghs_bot_token',
        installationTokenExpiresAt: '2026-03-17T21:00:00Z',
      });
    });

    it('should match via git remote', async () => {
      vi.mocked(loadCachedAuth).mockReturnValue({ userToken: 'gho_test', userLogin: 'alice' });
      vi.mocked(listInstallations).mockResolvedValue([
        {
          id: 42, account: 'alice', repositories: [
            { full_name: 'alice/repo1', name: 'repo1' },
            { full_name: 'alice/repo2', name: 'repo2' },
          ],
        },
      ]);
      vi.mocked(getInstallationToken).mockResolvedValue({
        token: 'ghs_bot_token',
        expiresAt: '2026-03-17T21:00:00Z',
      });
      vi.mocked(execSync).mockReturnValue('git@github.com:alice/repo2.git\n');

      const config = await resolveGitHubAuth();

      expect(config.owner).toBe('alice');
      expect(config.repo).toBe('repo2');
    });

    it('should throw when multiple repos and no git remote match', async () => {
      vi.mocked(loadCachedAuth).mockReturnValue({ userToken: 'gho_test', userLogin: 'alice' });
      vi.mocked(listInstallations).mockResolvedValue([
        {
          id: 42, account: 'alice', repositories: [
            { full_name: 'alice/repo1', name: 'repo1' },
            { full_name: 'alice/repo2', name: 'repo2' },
          ],
        },
      ]);
      vi.mocked(execSync).mockReturnValue('git@github.com:alice/other.git\n');

      await expect(resolveGitHubAuth()).rejects.toThrow('Could not determine target repository');
    });
  });
});

describe('parseGitHubUrl', () => {
  it('should parse SSH URLs', () => {
    expect(parseGitHubUrl('git@github.com:alice/repo.git')).toBe('alice/repo');
    expect(parseGitHubUrl('git@github.com:alice/repo')).toBe('alice/repo');
  });

  it('should parse HTTPS URLs', () => {
    expect(parseGitHubUrl('https://github.com/alice/repo.git')).toBe('alice/repo');
    expect(parseGitHubUrl('https://github.com/alice/repo')).toBe('alice/repo');
  });

  it('should return null for non-GitHub URLs', () => {
    expect(parseGitHubUrl('git@gitlab.com:alice/repo.git')).toBeNull();
    expect(parseGitHubUrl('https://bitbucket.org/alice/repo')).toBeNull();
  });
});
