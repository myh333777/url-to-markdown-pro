/**
 * Exa AI Fetch Strategy via MCP HTTP Protocol
 * Uses Exa's free MCP endpoint with crawling tool enabled
 * No API key required!
 */

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp?tools=web_search_exa,crawling_exa";

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

/**
 * Initialize MCP session
 */
async function initMcpSession(): Promise<boolean> {
    try {
        const response = await fetch(EXA_MCP_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "init-1",
                method: "initialize",
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "url-to-markdown", version: "2.2.0" },
                },
            }),
        });

        mcpSessionId = response.headers.get("mcp-session-id");

        const text = await response.text();
        const dataMatch = text.match(/data: (.+)/);
        if (dataMatch) {
            const data = JSON.parse(dataMatch[1]);
            return data.result?.serverInfo !== undefined;
        }

        return mcpSessionId !== null;
    } catch (error) {
        console.error("[Exa MCP] Init error:", error);
        return false;
    }
}

/**
 * Call MCP tool
 */
async function callMcpTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<unknown> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            ...(mcpSessionId && { "mcp-session-id": mcpSessionId }),
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now().toString(),
            method: "tools/call",
            params: {
                name: toolName,
                arguments: args,
            },
        }),
    });

    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
        mcpSessionId = newSessionId;
    }

    const text = await response.text();
    const dataMatch = text.match(/data: (.+)/);
    if (dataMatch) {
        const data = JSON.parse(dataMatch[1]);
        if (data.error) {
            throw new Error(data.error.message);
        }
        return data.result;
    }

    throw new Error("Invalid MCP response format");
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

async function fetchReutersMirror(url: string): Promise<string | null> {
    const title = getReutersTitleFromUrl(url);
    if (!title) return null;

    const searchResult = await callMcpTool("web_search_exa", {
        query: `Full syndicated copy of Reuters article "${title}"`,
        numResults: 5,
    });
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
        });
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
export async function fetchWithExa(url: string): Promise<ExaResult> {
    try {
        // Initialize session if needed
        if (!mcpSessionId) {
            const initialized = await initMcpSession();
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
        });

        // Parse MCP result
        const { text: resultText, isError } = getTextContent(result);
        if (resultText) {
            if (isError) {
                const mirrorText = await fetchReutersMirror(url);
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
        mcpSessionId = null;

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "exa",
        };
    }
}
