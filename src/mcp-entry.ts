import { startMcpServer } from './mcp/server.js';

startMcpServer().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
