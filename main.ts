import { indexHtml } from "./src/index-template.ts";
console.log("[Init] Starting url-to-markdown v2.1.0");
import {
    generateJsonData,
    generateMarkdownText,
} from "./src/html-to-markdown.ts";
import {
    addCorsHeaders,
    downloadHeaders,
    fetchHtmlWithStrategies,
    generateFilename,
} from "./src/utils.ts";
import type { Strategy } from "./src/strategies/mod.ts";
import { extractFromJsonLd } from "./src/jsonld.ts";

// ============== URL Cache ==============
const urlCache = new Map<string, { data: CacheEntry; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
    content: string;
    strategy: string;
    contentType: string;
    title?: string;
}

function getCached(url: string): CacheEntry | null {
    const entry = urlCache.get(url);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
        urlCache.delete(url);
        return null;
    }

    console.log(`[Cache] Hit for: ${url}`);
    return entry.data;
}

function setCache(url: string, data: CacheEntry): void {
    // Limit cache size to 100 entries
    if (urlCache.size >= 100) {
        const oldest = urlCache.keys().next().value;
        if (oldest) urlCache.delete(oldest);
    }
    urlCache.set(url, { data, timestamp: Date.now() });
}

// ============== Options ==============
interface ConversionOptions {
    bypass: boolean;
    preserveImages: boolean;
    strategy?: Strategy;
    download: boolean;
    jsonFormat: boolean;
    useCache: boolean;
}

interface ConversionResult {
    content: string;
    strategy: string;
    contentType: string;
    elapsed: number;
    fromCache: boolean;
    title?: string;
}

function parseOptions(formData: FormData): ConversionOptions {
    return {
        bypass: !!formData.get("bypass"),
        preserveImages: formData.get("images") !== "false", // Default true
        strategy: formData.get("strategy") as Strategy | undefined,
        download: !!formData.get("download"),
        jsonFormat: !!formData.get("json"),
        useCache: formData.get("cache") !== "false", // Default true
    };
}

async function handleConversion(url: string, options: ConversionOptions): Promise<ConversionResult> {
    const startTime = Date.now();
    const { bypass, preserveImages, strategy, jsonFormat, useCache } = options;

    // Check cache first
    if (useCache) {
        const cached = getCached(url);
        if (cached) {
            return {
                ...cached,
                elapsed: Date.now() - startTime,
                fromCache: true,
            };
        }
    }

    // Fetch content with strategies
    const fetchResult = await fetchHtmlWithStrategies(url, {
        bypass,
        strategy,
    });

    if (!fetchResult.success) {
        throw new Error(fetchResult.error || "Failed to fetch content");
    }

    let result: CacheEntry;

    // If Jina returned markdown directly, use it
    if (fetchResult.markdown) {
        if (jsonFormat) {
            const jsonData = {
                url,
                title: "Extracted Content",
                date: new Date().toISOString(),
                content: fetchResult.markdown,
                strategy: fetchResult.strategy,
                elapsed: fetchResult.elapsed,
            };
            result = {
                content: JSON.stringify(jsonData, null, 2),
                strategy: fetchResult.strategy,
                contentType: "application/json",
            };
        } else {
            result = {
                content: fetchResult.markdown,
                strategy: fetchResult.strategy,
                contentType: "text/plain; charset=utf-8",
            };
        }
    } else if (fetchResult.html) {
        // Try JSON-LD extraction first
        const jsonLd = extractFromJsonLd(fetchResult.html);

        if (jsonLd && jsonLd.content.length > 500) {
            console.log(`[JSON-LD] Using structured data for: ${url}`);

            let markdown = `# ${jsonLd.title}\n\n`;
            if (jsonLd.author) {
                markdown += `*By ${jsonLd.author}*\n\n`;
            }
            markdown += jsonLd.content;

            if (jsonFormat) {
                const jsonData = {
                    url,
                    title: jsonLd.title,
                    date: jsonLd.date || new Date().toISOString(),
                    content: markdown,
                    strategy: fetchResult.strategy,
                    author: jsonLd.author,
                };
                result = {
                    content: JSON.stringify(jsonData, null, 2),
                    strategy: fetchResult.strategy,
                    contentType: "application/json",
                    title: jsonLd.title,
                };
            } else {
                result = {
                    content: markdown,
                    strategy: fetchResult.strategy,
                    contentType: "text/plain; charset=utf-8",
                    title: jsonLd.title,
                };
            }
        } else {
            // Fallback to Readability + Turndown
            if (jsonFormat) {
                result = {
                    content: generateJsonData(fetchResult.html, url, fetchResult.strategy, preserveImages),
                    strategy: fetchResult.strategy,
                    contentType: "application/json",
                };
            } else {
                result = {
                    content: generateMarkdownText(fetchResult.html, preserveImages),
                    strategy: fetchResult.strategy,
                    contentType: "text/plain; charset=utf-8",
                };
            }
        }
    } else {
        throw new Error("No content received from fetch");
    }

    // Save to cache
    if (useCache) {
        setCache(url, result);
    }

    return {
        ...result,
        elapsed: Date.now() - startTime,
        fromCache: false,
    };
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
                        version: "2.4.13",
                        features: [
                            "parallel_fetch",
                            "json_ld",
                            "readability",
                            "turndown_gfm",
                            "cache",
                            "multi_strategy",
                            "spa_check",
                            "exa",
                        ],
                        cacheSize: urlCache.size,
                    }),
                    { headers: { "content-type": "application/json" } }
                );
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
                    const options: ConversionOptions = {
                        bypass: url.searchParams.get("bypass") === "true",
                        preserveImages: url.searchParams.get("images") !== "false",
                        strategy: url.searchParams.get("strategy") as Strategy | undefined,
                        download: false,
                        jsonFormat: url.searchParams.get("format") === "json",
                        useCache: url.searchParams.get("cache") !== "false",
                    };

                    const result = await handleConversion(targetUrl, options);
                    const headers = new Headers({ "content-type": result.contentType });
                    addCorsHeaders(headers);
                    headers.set("X-Strategy-Used", result.strategy);
                    headers.set("X-Elapsed-Ms", String(result.elapsed));
                    headers.set("X-From-Cache", String(result.fromCache));

                    return new Response(result.content, { headers });
                } catch (error) {
                    return new Response(
                        JSON.stringify({ error: error.message }),
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
            try {
                const formData = await request.formData();
                const targetUrl = formData.get("url") as string;

                if (!targetUrl) {
                    return new Response("Missing URL parameter", { status: 400 });
                }

                const options = parseOptions(formData);
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
                console.error("Error processing request:", error);
                return new Response(
                    `Error processing request: ${error.message}`,
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
