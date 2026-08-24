/**
 * Exa AI Fetch Strategy via MCP HTTP Protocol
 * Uses Exa's free MCP endpoint with crawling tool enabled
 * No API key required!
 */

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp?tools=web_search_exa,crawling_exa";
const EXA_BREAKER_MS = 5 * 60 * 1000;
const EXA_MAX_CONCURRENCY = 2;

export interface ExaResult {
    success: boolean;
    html?: string;
    markdown?: string;
    title?: string;
    error?: string;
    strategy: string;
}

// Session ID for MCP protocol
let mcpSessionId: string | null = null;
let initPromise: Promise<boolean> | null = null;
let exaBlockedUntil = 0;
let exaActive = 0;
const exaWaiters: Array<() => void> = [];

class ExaHttpError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = "ExaHttpError";
    }
}

function getAuthHeader(): Record<string, string> {
    try {
        const key = Deno.env.get("EXA_API_KEY")?.trim();
        return key ? { Authorization: `Bearer ${key}` } : {};
    } catch {
        return {};
    }
}

async function acquireExaSlot(): Promise<void> {
    if (exaActive < EXA_MAX_CONCURRENCY) {
        exaActive += 1;
        return;
    }
    await new Promise<void>((resolve) => exaWaiters.push(resolve));
    exaActive += 1;
}

function releaseExaSlot(): void {
    exaActive = Math.max(0, exaActive - 1);
    exaWaiters.shift()?.();
}

function tripBreaker(): void {
    exaBlockedUntil = Date.now() + EXA_BREAKER_MS;
}

function parseJsonRpcPayload(text: string, contentType: string, requestId: string): any {
    const candidates: any[] = [];

    if (contentType.includes("application/json")) {
        try {
            candidates.push(JSON.parse(text));
        } catch {
            // Fall through to SSE parsing below.
        }
    }

    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
            candidates.push(JSON.parse(raw));
        } catch {
            // Ignore non-JSON SSE data frames.
        }
    }

    return candidates.find((item) => String(item?.id) === requestId)
        || candidates.find((item) => item?.result !== undefined || item?.error !== undefined)
        || null;
}

async function readMcpResponse(response: Response, requestId: string): Promise<any> {
    const text = await response.text();
    const payload = parseJsonRpcPayload(
        text,
        response.headers.get("content-type") || "",
        requestId,
    );

    const errorMessage = payload?.error?.message
        || (response.ok ? "" : text.slice(0, 500))
        || `Exa MCP HTTP ${response.status}`;

    if (response.status === 429 || /rate limit/i.test(errorMessage)) {
        tripBreaker();
        throw new ExaHttpError("Exa rate limited; circuit breaker opened", 429);
    }

    if (!response.ok) {
        throw new ExaHttpError(errorMessage, response.status);
    }
    if (!payload) {
        throw new Error("Invalid MCP response format");
    }
    if (payload.error) {
        throw new Error(payload.error.message || "Exa MCP error");
    }
    return payload.result;
}

/**
 * Initialize MCP session
 */
async function initMcpSession(signal?: AbortSignal): Promise<boolean> {
    if (mcpSessionId) return true;
    if (initPromise) return await initPromise;

    initPromise = (async () => {
      try {
        const requestId = `init-${Date.now()}`;
        const response = await fetch(EXA_MCP_ENDPOINT, {
            method: "POST",
            signal,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                ...getAuthHeader(),
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: requestId,
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "url-to-markdown", version: "2.2.0" },
                },
            }),
        });

        mcpSessionId = response.headers.get("mcp-session-id");
        const result = await readMcpResponse(response, requestId);
        return result?.serverInfo !== undefined || mcpSessionId !== null;
      } catch (error) {
        console.error("[Exa MCP] Init error:", error);
        mcpSessionId = null;
        return false;
      } finally {
        initPromise = null;
      }
    })();

    return await initPromise;
}

/**
 * Call MCP tool
 */
async function callMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!mcpSessionId && !(await initMcpSession(signal))) {
            throw new Error("Failed to initialize Exa MCP session");
        }

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const response = await fetch(EXA_MCP_ENDPOINT, {
            method: "POST",
            signal,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                ...getAuthHeader(),
                ...(mcpSessionId && { "mcp-session-id": mcpSessionId }),
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: requestId,
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: args,
                },
            }),
        });

        const newSessionId = response.headers.get("mcp-session-id");
        if (newSessionId) mcpSessionId = newSessionId;

        try {
            return await readMcpResponse(response, requestId);
        } catch (error) {
            if (
                attempt === 0 &&
                error instanceof ExaHttpError &&
                [400, 401, 404].includes(error.status)
            ) {
                mcpSessionId = null;
                continue;
            }
            throw error;
        }
    }

    throw new Error("Exa MCP request failed");
}

function getTextContent(result: unknown): { text?: string; isError: boolean } {
    const content = result as {
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
    };
    const textContent = content.content?.find((c) => c.type === "text");
    return { text: textContent?.text, isError: content.isError === true };
}

function getReutersTitleFromUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith("reuters.com")) return null;

        const slug = parsed.pathname.split("/").filter(Boolean).at(-1);
        if (!slug) return null;

        return slug
            .replace(/-\d{4}-\d{2}-\d{2}$/, "")
            .split("-")
            .filter(Boolean)
            .join(" ");
    } catch {
        return null;
    }
}

async function fetchReutersMirror(url: string, signal?: AbortSignal): Promise<string | null> {
    const title = getReutersTitleFromUrl(url);
    if (!title) return null;

    const searchResult = await callMcpTool("web_search_exa", {
        query: `Full syndicated copy of Reuters article "${title}"`,
        numResults: 5,
    }, signal);
    const { text: searchText, isError: searchFailed } = getTextContent(searchResult);
    if (searchFailed || !searchText) return null;

    const mirrorUrls = [...searchText.matchAll(/^URL:\s+(https?:\/\/\S+)/gm)]
        .map((match) => match[1])
        .filter((candidate) => {
            try {
                return !new URL(candidate).hostname.endsWith("reuters.com");
            } catch {
                return false;
            }
        })
        .slice(0, 5);

    if (mirrorUrls.length === 0) return null;

    for (const mirrorUrl of mirrorUrls.slice(0, 3)) {
        const crawlResult = await callMcpTool("crawling_exa", {
            urls: [mirrorUrl],
            maxCharacters: 50000,
        }, signal);
        const { text: mirrorText, isError: crawlFailed } = getTextContent(crawlResult);

        if (!crawlFailed && mirrorText && mirrorText.length >= 500) {
            return mirrorText;
        }
    }

    return null;
}

/**
 * Fetch URL content using Exa MCP crawling tool
 */
export async function fetchWithExa(url: string, signal?: AbortSignal): Promise<ExaResult> {
    if (exaBlockedUntil > Date.now()) {
        return {
            success: false,
            error: `Exa circuit breaker open for ${Math.ceil((exaBlockedUntil - Date.now()) / 1000)}s`,
            strategy: "exa",
        };
    }

    await acquireExaSlot();
    try {
        // Initialize session if needed
        if (!mcpSessionId) {
            const initialized = await initMcpSession(signal);
            if (!initialized) {
                return {
                    success: false,
                    error: "Failed to initialize Exa MCP session",
                    strategy: "exa",
                };
            }
        }

        // Use crawling_exa tool to get URL content
        const result = await callMcpTool("crawling_exa", {
            urls: [url],
            maxCharacters: 50000,
        }, signal);

        // Parse MCP result
        const { text: resultText, isError } = getTextContent(result);
        if (resultText) {
            if (isError) {
                const mirrorText = await fetchReutersMirror(url, signal);
                if (mirrorText) {
                    return {
                        success: true,
                        markdown: mirrorText,
                        strategy: "exa",
                    };
                }

                return {
                    success: false,
                    error: resultText,
                    strategy: "exa",
                };
            }

            // Try to parse as JSON first (Exa returns structured data)
            try {
                const parsed = JSON.parse(resultText);

                // Check for results array (Exa standard format)
                if (parsed.results && Array.isArray(parsed.results)) {
                    if (parsed.results.length === 0) {
                        return {
                            success: false,
                            error: "Exa returned zero results",
                            strategy: "exa",
                        };
                    }

                    const firstResult = parsed.results[0];
                    if (firstResult) {
                        // Check for error status in result
                        if (firstResult.status === "error" || !firstResult.id) {
                            return {
                                success: false,
                                error: `Exa crawl failed: ${firstResult.error?.tag || firstResult.status}`,
                                strategy: "exa"
                            };
                        }

                        return {
                            success: true,
                            markdown: firstResult.text || firstResult.content,
                            title: firstResult.title,
                            strategy: "exa",
                        };
                    }
                }

                if (parsed.text || parsed.content) {
                    return {
                        success: true,
                        markdown: parsed.text || parsed.content,
                        title: parsed.title,
                        strategy: "exa",
                    };
                }
            } catch {
                // Not JSON, use raw text but ensure it's not an internal error string
                if (resultText.includes("CRAWL_LIVECRAWL_TIMEOUT")) {
                    return {
                        success: false,
                        error: "Exa timeout in text response",
                        strategy: "exa"
                    };
                }
            }

            return {
                success: true,
                markdown: resultText,
                strategy: "exa",
            };
        }

        return {
            success: false,
            error: "No content returned from Exa",
            strategy: "exa",
        };
    } catch (error) {
        // Reset session on error for retry
        if (!(error instanceof ExaHttpError && error.status === 429)) {
            mcpSessionId = null;
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "exa",
        };
    } finally {
        releaseExaSlot();
    }
}
