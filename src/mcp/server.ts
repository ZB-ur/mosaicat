import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RunManager } from '../core/run-manager.js';
import { registerTools } from './tools.js';

export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'mosaicat',
    version: '0.1.0',
  });

  const runManager = new RunManager();
  registerTools(server, runManager);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
}
