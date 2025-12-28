/**
 * Custom SSE Transport for Deno
 * Implements MCP SSE protocol compatible with Deno's native Response
 */

import { Transport } from "npm:@modelcontextprotocol/sdk@1.11.0/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "npm:@modelcontextprotocol/sdk@1.11.0/types.js";

export interface DenoSSESession {
    id: string;
    controller: ReadableStreamDefaultController<Uint8Array>;
    messageQueue: JSONRPCMessage[];
    onMessage?: (message: JSONRPCMessage) => Promise<void>;
    closed: boolean;
    heartbeatTimer?: number;  // Heartbeat timer ID
}

const sessions = new Map<string, DenoSSESession>();

// Heartbeat interval (25 seconds - slightly less than typical 30s timeout)
const HEARTBEAT_INTERVAL = 25000;

/**
 * Create SSE response for initial connection
 */
export function createSSEResponse(messageEndpoint: string): { response: Response; sessionId: string } {
    const sessionId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            // Store session
            const session: DenoSSESession = {
                id: sessionId,
                controller,
                messageQueue: [],
                closed: false,
            };
            sessions.set(sessionId, session);

            // Send endpoint event (MCP protocol requirement)
            const endpointData = `${messageEndpoint}?sessionId=${sessionId}`;
            controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointData}\n\n`));

            // Start heartbeat timer to keep connection alive
            session.heartbeatTimer = setInterval(() => {
                if (!session.closed) {
                    try {
                        // Send SSE comment (: prefix) as heartbeat - doesn't trigger client events
                        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
                    } catch {
                        // Connection closed, stop heartbeat
                        clearInterval(session.heartbeatTimer);
                    }
                }
            }, HEARTBEAT_INTERVAL);
        },
        cancel() {
            const session = sessions.get(sessionId);
            if (session) {
                session.closed = true;
                if (session.heartbeatTimer) {
                    clearInterval(session.heartbeatTimer);
                }
                sessions.delete(sessionId);
            }
            console.log(`[SSE] Session closed: ${sessionId}`);
        },
    });

    const response = new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Session-Id": sessionId,
        },
    });

    return { response, sessionId };
}

/**
 * Send message to SSE client
 */
export function sendSSEMessage(sessionId: string, message: JSONRPCMessage): boolean {
    const session = sessions.get(sessionId);
    if (!session || session.closed) {
        return false;
    }

    const encoder = new TextEncoder();
    const data = JSON.stringify(message);
    session.controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
    return true;
}

/**
 * Handle incoming POST message for a session
 */
export async function handleSSEMessage(
    sessionId: string,
    body: string
): Promise<{ handled: boolean; error?: string }> {
    const session = sessions.get(sessionId);
    if (!session) {
        return { handled: false, error: "Session not found" };
    }

    try {
        const message = JSONRPCMessageSchema.parse(JSON.parse(body));

        if (session.onMessage) {
            await session.onMessage(message);
        }

        return { handled: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { handled: false, error: errorMessage };
    }
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): DenoSSESession | undefined {
    return sessions.get(sessionId);
}

/**
 * Set message handler for a session
 */
export function setSessionMessageHandler(
    sessionId: string,
    handler: (message: JSONRPCMessage) => Promise<void>
): boolean {
    const session = sessions.get(sessionId);
    if (!session) return false;
    session.onMessage = handler;
    return true;
}

/**
 * Close session
 */
export function closeSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
        session.closed = true;
        // Clear heartbeat timer
        if (session.heartbeatTimer) {
            clearInterval(session.heartbeatTimer);
        }
        try {
            session.controller.close();
        } catch {
            // Already closed
        }
        sessions.delete(sessionId);
    }
}

/**
 * Deno SSE Transport - implements MCP Transport interface
 */
export class DenoSSETransport implements Transport {
    private sessionId: string;
    private _onmessage?: (message: JSONRPCMessage) => void;
    private _onclose?: () => void;
    private _onerror?: (error: Error) => void;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }

    get onmessage(): ((message: JSONRPCMessage) => void) | undefined {
        return this._onmessage;
    }

    set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
        this._onmessage = handler;
        if (handler) {
            setSessionMessageHandler(this.sessionId, async (message) => {
                handler(message);
            });
        }
    }

    get onclose(): (() => void) | undefined {
        return this._onclose;
    }

    set onclose(handler: (() => void) | undefined) {
        this._onclose = handler;
    }

    get onerror(): ((error: Error) => void) | undefined {
        return this._onerror;
    }

    set onerror(handler: ((error: Error) => void) | undefined) {
        this._onerror = handler;
    }

    async start(): Promise<void> {
        // Already started via createSSEResponse
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!sendSSEMessage(this.sessionId, message)) {
            throw new Error("Failed to send message: session closed");
        }
    }

    async close(): Promise<void> {
        closeSession(this.sessionId);
        if (this._onclose) {
            this._onclose();
        }
    }
}
