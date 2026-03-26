import { startMcpServer } from './mcp/server.js';

startMcpServer().catch((err) => {
  process.stderr.write(`Failed to start MCP server: ${err}\n`);
  process.exit(1);
});
