import { indexHtml } from "./src/index-template.ts";
console.log("[Init] Starting url-to-markdown v2.5.0");

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.11.0/server/mcp.js";
import { registerTools } from "./src/mcp/tools.ts";
import {
    createSSEResponse,
    DenoSSETransport,
    handleSSEMessage,
} from "./src/mcp/deno-sse.ts";
import {
    handleStreamableRequest,
    getStreamableSessionCount,
} from "./src/mcp/streamable-http.ts";
import {
    handleConversion,
    parseFormOptions,
    parseQueryOptions,
    getCacheSize,
} from "./src/core/conversion.ts";
import {
    addCorsHeaders,
    downloadHeaders,
    generateFilename,
} from "./src/utils.ts";

// MCP Server instances per session
const mcpServers = new Map<string, McpServer>();

function createMcpServerForSession(sessionId: string): McpServer {
    const server = new McpServer({
        name: "url-to-markdown",
        version: "2.5.0",
    });
    registerTools(server);
    mcpServers.set(sessionId, server);
    return server;
}

Deno.serve(async (request: Request) => {
    const url = new URL(request.url);

    switch (request.method) {
        case "GET": {
            // Health check endpoint
            if (url.pathname === "/health") {
                return new Response(
                    JSON.stringify({
                        status: "healthy",
                        service: "url-to-markdown",
                        version: "2.5.0",
                        features: [
                            "parallel_fetch",
                            "json_ld",
                            "readability",
                            "turndown_gfm",
                            "cache",
                            "multi_strategy",
                            "spa_check",
                            "exa",
                            "mcp_sse",
                            "mcp_streamable_http",
                        ],
                        cacheSize: getCacheSize(),
                        mcpSessions: mcpServers.size,
                    }),
                    { headers: { "content-type": "application/json" } }
                );
            }

            // MCP SSE endpoint - establish SSE connection
            if (url.pathname === "/mcp/sse" || url.pathname === "/sse") {
                console.log("[MCP] New SSE connection request");

                const { response, sessionId } = createSSEResponse("/mcp/message");

                // Create MCP server and connect via custom transport
                const server = createMcpServerForSession(sessionId);
                const transport = new DenoSSETransport(sessionId);

                // Connect server (this sets up message handling)
                server.connect(transport).catch((error) => {
                    console.error("[MCP] Connection error:", error);
                });

                console.log(`[MCP] SSE session created: ${sessionId}`);
                return response;
            }

            // Handle API GET requests with query params
            if (url.pathname === "/api" || url.pathname === "/api/") {
                const targetUrl = url.searchParams.get("url");
                if (!targetUrl) {
                    return new Response(
                        JSON.stringify({ error: "Missing 'url' parameter" }),
                        { status: 400, headers: { "content-type": "application/json" } }
                    );
                }

                try {
                    const options = parseQueryOptions(url.searchParams);
                    const result = await handleConversion(targetUrl, options);
                    const headers = new Headers({ "content-type": result.contentType });
                    addCorsHeaders(headers);
                    headers.set("X-Strategy-Used", result.strategy);
                    headers.set("X-Elapsed-Ms", String(result.elapsed));
                    headers.set("X-From-Cache", String(result.fromCache));

                    return new Response(result.content, { headers });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return new Response(
                        JSON.stringify({ error: message }),
                        { status: 500, headers: addCorsHeaders(new Headers({ "content-type": "application/json" })) }
                    );
                }
            }

            // Serve index page
            return new Response(indexHtml, {
                headers: addCorsHeaders(
                    new Headers({ "content-type": "text/html" }),
                ),
            });
        }

        case "POST": {
            // MCP Streamable HTTP endpoint (recommended)
            if (url.pathname === "/mcp") {
                return handleStreamableRequest(request);
            }

            // MCP SSE message endpoint (legacy)
            if (url.pathname === "/mcp/message" || url.pathname === "/message") {
                const sessionId = url.searchParams.get("sessionId") || request.headers.get("X-Session-Id");

                if (!sessionId) {
                    return new Response(
                        JSON.stringify({ error: "Missing sessionId" }),
                        { status: 400, headers: { "content-type": "application/json" } }
                    );
                }

                if (!mcpServers.has(sessionId)) {
                    return new Response(
                        JSON.stringify({ error: "Session not found. Please reconnect to /mcp/sse" }),
                        { status: 404, headers: { "content-type": "application/json" } }
                    );
                }

                try {
                    const body = await request.text();
                    const result = await handleSSEMessage(sessionId, body);

                    if (!result.handled) {
                        return new Response(
                            JSON.stringify({ error: result.error }),
                            { status: 400, headers: { "content-type": "application/json" } }
                        );
                    }

                    return new Response(null, { status: 202 });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error("[MCP] Message handling error:", message);
                    return new Response(
                        JSON.stringify({ error: message }),
                        { status: 500, headers: { "content-type": "application/json" } }
                    );
                }
            }

            // Original form POST handling
            try {
                const formData = await request.formData();
                const targetUrl = formData.get("url") as string;

                if (!targetUrl) {
                    return new Response("Missing URL parameter", { status: 400 });
                }

                const options = parseFormOptions(formData);
                const result = await handleConversion(targetUrl, options);

                const headers = new Headers();
                addCorsHeaders(headers);
                headers.set("content-type", result.contentType);
                headers.set("X-Strategy-Used", result.strategy);
                headers.set("X-Elapsed-Ms", String(result.elapsed));
                headers.set("X-From-Cache", String(result.fromCache));

                if (options.download) {
                    const fileName = generateFilename(targetUrl, options.jsonFormat);
                    downloadHeaders(headers, fileName, result.content.length);
                }

                return new Response(result.content, { headers });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error("Error processing request:", message);
                return new Response(
                    `Error processing request: ${message}`,
                    {
                        status: 500,
                        headers: addCorsHeaders(new Headers()),
                    },
                );
            }
        }

        case "OPTIONS":
            return new Response(null, {
                headers: addCorsHeaders(new Headers()),
            });

        default:
            return new Response("Invalid HTTP method", {
                status: 405,
            });
    }
});
