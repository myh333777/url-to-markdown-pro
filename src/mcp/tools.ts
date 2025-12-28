/**
 * MCP Tools Module
 * Defines tools for the Model Context Protocol server
 */

import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.11.0/server/mcp.js";
import { z } from "npm:zod@3.25.1";
import { handleConversion, type ConversionOptions } from "../core/conversion.ts";
import type { Strategy } from "../strategies/mod.ts";

/**
 * Register MCP tools on the server
 */
export function registerTools(server: McpServer): void {
    // Tool: fetch_url - Fetch a single URL and convert to Markdown
    server.tool(
        "fetch_url",
        "Fetch a URL and convert its content to Markdown. Supports paywall bypass strategies.",
        {
            url: z.string().url().describe("The URL to fetch and convert to Markdown"),
            bypass: z.boolean().optional().default(true).describe("Enable automatic multi-strategy fetch for best results (recommended)"),
            preserveImages: z.boolean().optional().default(true).describe("Preserve images in the Markdown output"),
            strategy: z.enum(["direct", "googlebot", "facebookbot", "bingbot", "archive", "12ft", "jina", "exa"]).optional().describe("Specific fetch strategy to use"),
        },
        async ({ url, bypass, preserveImages, strategy }) => {
            try {
                const options: ConversionOptions = {
                    bypass: bypass ?? false,
                    preserveImages: preserveImages ?? true,
                    strategy: strategy as Strategy | undefined,
                    download: false,
                    jsonFormat: false,
                    useCache: true,
                };

                const result = await handleConversion(url, options);

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: result.content,
                        },
                    ],
                    _meta: {
                        strategy: result.strategy,
                        elapsed: result.elapsed,
                        fromCache: result.fromCache,
                        title: result.title,
                    },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Error fetching URL: ${message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // Tool: fetch_urls - Batch fetch multiple URLs
    server.tool(
        "fetch_urls",
        "Fetch multiple URLs and convert their content to Markdown. Returns results for each URL.",
        {
            urls: z.array(z.string().url()).min(1).max(10).describe("Array of URLs to fetch (max 10)"),
            bypass: z.boolean().optional().default(true).describe("Enable automatic multi-strategy fetch for best results (recommended)"),
            preserveImages: z.boolean().optional().default(true).describe("Preserve images in the Markdown output"),
        },
        async ({ urls, bypass, preserveImages }) => {
            const results: Array<{ url: string; success: boolean; content?: string; error?: string; strategy?: string }> = [];

            // Process URLs in parallel with concurrency limit
            const CONCURRENCY = 3;
            for (let i = 0; i < urls.length; i += CONCURRENCY) {
                const batch = urls.slice(i, i + CONCURRENCY);
                const batchResults = await Promise.allSettled(
                    batch.map(async (url) => {
                        const options: ConversionOptions = {
                            bypass: bypass ?? false,
                            preserveImages: preserveImages ?? true,
                            strategy: undefined,
                            download: false,
                            jsonFormat: false,
                            useCache: true,
                        };

                        const result = await handleConversion(url, options);
                        return { url, result };
                    })
                );

                for (const outcome of batchResults) {
                    if (outcome.status === "fulfilled") {
                        results.push({
                            url: outcome.value.url,
                            success: true,
                            content: outcome.value.result.content,
                            strategy: outcome.value.result.strategy,
                        });
                    } else {
                        const url = batch[batchResults.indexOf(outcome)];
                        results.push({
                            url,
                            success: false,
                            error: outcome.reason?.message || "Unknown error",
                        });
                    }
                }
            }

            // Format output
            const output = results.map((r) => {
                if (r.success) {
                    return `## ${r.url}\n\n${r.content}\n\n---\n`;
                } else {
                    return `## ${r.url}\n\n**Error:** ${r.error}\n\n---\n`;
                }
            }).join("\n");

            return {
                content: [
                    {
                        type: "text" as const,
                        text: output,
                    },
                ],
                _meta: {
                    totalUrls: urls.length,
                    successful: results.filter((r) => r.success).length,
                    failed: results.filter((r) => !r.success).length,
                },
            };
        }
    );
}
