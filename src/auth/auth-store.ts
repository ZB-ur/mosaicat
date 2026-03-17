import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CachedAuth } from './types.js';

const AUTH_DIR = path.join(os.homedir(), '.mosaicat');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export function getAuthFilePath(): string {
  return AUTH_FILE;
}

export function loadCachedAuth(): CachedAuth | null {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.userToken === 'string' && typeof data.userLogin === 'string') {
      return { userToken: data.userToken, userLogin: data.userLogin };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedAuth(auth: CachedAuth): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function clearCachedAuth(): void {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch {
    // File doesn't exist — nothing to clear
  }
}
