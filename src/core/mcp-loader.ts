import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

const MCP_CONFIG_PATH = 'config/mcp-servers.yaml';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServersYaml {
  servers?: Record<string, McpServerConfig>;
}

/**
 * Load preset MCP server configs from config/mcp-servers.yaml.
 * If external MCP servers are defined, writes a temp JSON config file
 * compatible with `claude --mcp-config <path>`.
 *
 * Returns the path to the temp config file, or undefined if no external servers.
 */
export function loadMcpConfig(): string | undefined {
  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    return undefined;
  }

  const raw = yaml.load(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8')) as McpServersYaml;

  if (!raw?.servers || Object.keys(raw.servers).length === 0) {
    return undefined;
  }

  // Write temp JSON config for --mcp-config flag
  const mcpConfig = {
    mcpServers: raw.servers,
  };

  const tmpDir = path.join(os.tmpdir(), 'mosaicat');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, 'mcp-config.json');
  fs.writeFileSync(tmpPath, JSON.stringify(mcpConfig, null, 2));

  return tmpPath;
}
