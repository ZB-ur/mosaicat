import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock fs to avoid touching the real filesystem
vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import { loadCachedAuth, saveCachedAuth, clearCachedAuth, getAuthFilePath } from '../auth-store.js';

const expectedPath = path.join(os.homedir(), '.mosaicat', 'auth.json');

describe('auth-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuthFilePath', () => {
    it('should return ~/.mosaicat/auth.json', () => {
      expect(getAuthFilePath()).toBe(expectedPath);
    });
  });

  describe('loadCachedAuth', () => {
    it('should return cached auth when file exists and is valid', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ userToken: 'gho_abc123', userLogin: 'alice' })
      );
      const result = loadCachedAuth();
      expect(result).toEqual({ userToken: 'gho_abc123', userLogin: 'alice' });
    });

    it('should return null when file does not exist', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      expect(loadCachedAuth()).toBeNull();
    });

    it('should return null when file contains invalid JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json');
      expect(loadCachedAuth()).toBeNull();
    });

    it('should return null when file is missing required fields', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ userToken: 'gho_abc' }));
      expect(loadCachedAuth()).toBeNull();
    });

    it('should return null when fields are wrong types', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ userToken: 123, userLogin: 'alice' })
      );
      expect(loadCachedAuth()).toBeNull();
    });
  });

  describe('saveCachedAuth', () => {
    it('should create directory and write file with restricted permissions', () => {
      saveCachedAuth({ userToken: 'gho_abc123', userLogin: 'alice' });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(os.homedir(), '.mosaicat'),
        { recursive: true }
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expectedPath,
        JSON.stringify({ userToken: 'gho_abc123', userLogin: 'alice' }, null, 2),
        { mode: 0o600 }
      );
    });
  });

  describe('clearCachedAuth', () => {
    it('should delete the auth file', () => {
      clearCachedAuth();
      expect(fs.unlinkSync).toHaveBeenCalledWith(expectedPath);
    });

    it('should not throw when file does not exist', () => {
      vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('ENOENT'); });
      expect(() => clearCachedAuth()).not.toThrow();
    });
  });
});
