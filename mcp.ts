/**
 * MCP Server Entry Point (stdio transport)
 * For use with Claude Desktop and local MCP clients
 */

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.11.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.11.0/server/stdio.js";
import { registerTools } from "./src/mcp/tools.ts";

console.error("[MCP] Starting url-to-markdown MCP server (stdio)...");

const server = new McpServer({
    name: "url-to-markdown",
    version: "2.5.0",
});

// Register tools
registerTools(server);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[MCP] Server connected via stdio");
