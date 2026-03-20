import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mosaicat');
const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json');

export interface UserLLMConfig {
  provider: string;       // provider name from pipeline.yaml pool
  apiKey?: string;        // stored locally, never committed
  model?: string;         // optional model override
}

export function loadUserLLMConfig(): UserLLMConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as UserLLMConfig;
  } catch {
    return null;
  }
}

export function saveUserLLMConfig(config: UserLLMConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  // Restrict permissions — contains API key
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function clearUserLLMConfig(): void {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {
    // ignore
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
