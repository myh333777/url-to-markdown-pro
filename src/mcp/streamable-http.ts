/**
 * Streamable HTTP Transport for Deno MCP Server
 * 
 * This implements the MCP Streamable HTTP protocol which uses
 * standard HTTP request/response instead of SSE long connections.
 * 
 * Benefits:
 * - No need for heartbeat/keepalive
 * - More reliable on edge networks
 * - Simpler to debug
 */

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.11.0/server/mcp.js";
import { Transport } from "npm:@modelcontextprotocol/sdk@1.11.0/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema, JSONRPCResponse, JSONRPCError } from "npm:@modelcontextprotocol/sdk@1.11.0/types.js";
import { registerTools } from "./tools.ts";

// Session storage for stateful connections
interface StreamableSession {
    id: string;
    server: McpServer;
    created: number;
}

const sessions = new Map<string, StreamableSession>();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.created > SESSION_TTL) {
            sessions.delete(id);
            console.log(`[Streamable] Session expired: ${id}`);
        }
    }
}, 60000);

/**
 * In-memory transport that handles single request/response
 */
class StreamableTransport implements Transport {
    private responseResolve?: (response: JSONRPCMessage) => void;
    private _onmessage?: (message: JSONRPCMessage) => void;
    private _onclose?: () => void;
    private _onerror?: (error: Error) => void;

    get onmessage() { return this._onmessage; }
    set onmessage(handler) { this._onmessage = handler; }

    get onclose() { return this._onclose; }
    set onclose(handler) { this._onclose = handler; }

    get onerror() { return this._onerror; }
    set onerror(handler) { this._onerror = handler; }

    async start(): Promise<void> {
        // No-op for streamable transport
    }

    async send(message: JSONRPCMessage): Promise<void> {
        // Resolve the pending response
        if (this.responseResolve) {
            this.responseResolve(message);
        }
    }

    async close(): Promise<void> {
        if (this._onclose) {
            this._onclose();
        }
    }

    /**
     * Process an incoming message and wait for response
     */
    async processMessage(message: JSONRPCMessage): Promise<JSONRPCMessage> {
        return new Promise((resolve) => {
            this.responseResolve = resolve;
            if (this._onmessage) {
                this._onmessage(message);
            }
        });
    }
}

/**
 * Create or get a session
 */
function getOrCreateSession(sessionId?: string): StreamableSession {
    if (sessionId && sessions.has(sessionId)) {
        return sessions.get(sessionId)!;
    }

    const id = sessionId || crypto.randomUUID();
    const server = new McpServer({
        name: "url-to-markdown",
        version: "2.5.0",
    });
    registerTools(server);

    const session: StreamableSession = {
        id,
        server,
        created: Date.now(),
    };
    sessions.set(id, session);
    console.log(`[Streamable] New session created: ${id}`);
    return session;
}

/**
 * Handle Streamable HTTP request
 * 
 * Protocol:
 * - POST /mcp with JSON-RPC body
 * - Optional X-Session-Id header for stateful sessions
 * - Returns JSON-RPC response
 */
export async function handleStreamableRequest(request: Request): Promise<Response> {
    const headers = new Headers({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    });

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { headers });
    }

    try {
        const body = await request.text();
        const message = JSONRPCMessageSchema.parse(JSON.parse(body));

        // Get or create session
        const sessionId = request.headers.get("X-Session-Id") || undefined;
        const session = getOrCreateSession(sessionId);

        // Add session ID to response headers
        headers.set("X-Session-Id", session.id);

        // Create transport for this request
        const transport = new StreamableTransport();

        // Connect server if not already connected
        await session.server.connect(transport);

        // Process the message
        const response = await transport.processMessage(message);

        return new Response(JSON.stringify(response), {
            headers,
            status: 200,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[Streamable] Error:", errorMessage);

        const errorResponse: JSONRPCError = {
            jsonrpc: "2.0",
            id: null,
            error: {
                code: -32600,
                message: errorMessage,
            },
        };

        return new Response(JSON.stringify(errorResponse), {
            headers,
            status: 400,
        });
    }
}

/**
 * Get session count for health check
 */
export function getStreamableSessionCount(): number {
    return sessions.size;
}
