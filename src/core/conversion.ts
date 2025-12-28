/**
 * Core Conversion Module
 * Extracted from main.ts for reuse in MCP tools
 */

import {
    generateJsonData,
    generateMarkdownText,
} from "../html-to-markdown.ts";
import {
    fetchHtmlWithStrategies,
} from "../utils.ts";
import type { Strategy } from "../strategies/mod.ts";
import { extractFromJsonLd } from "../jsonld.ts";

// ============== URL Cache (DISABLED) ==============
// Cache is disabled per user request
const urlCache = new Map<string, { data: CacheEntry; timestamp: number }>();

export interface CacheEntry {
    content: string;
    strategy: string;
    contentType: string;
    title?: string;
}

export function getCached(_url: string): CacheEntry | null {
    // Cache disabled - always return null
    return null;
}

export function setCache(_url: string, _data: CacheEntry): void {
    // Cache disabled - do nothing
}

export function getCacheSize(): number {
    return 0;
}

// ============== Options ==============
export interface ConversionOptions {
    bypass: boolean;
    preserveImages: boolean;
    strategy?: Strategy;
    download: boolean;
    jsonFormat: boolean;
    useCache: boolean;
}

export interface ConversionResult {
    content: string;
    strategy: string;
    contentType: string;
    elapsed: number;
    fromCache: boolean;
    title?: string;
}

/**
 * Handle URL to Markdown conversion
 */
export async function handleConversion(url: string, options: ConversionOptions): Promise<ConversionResult> {
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
                    content: generateMarkdownText(fetchResult.html, preserveImages, url),
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

/**
 * Parse form data to conversion options
 */
export function parseFormOptions(formData: FormData): ConversionOptions {
    return {
        bypass: !!formData.get("bypass"),
        preserveImages: formData.get("images") !== "false", // Default true
        strategy: formData.get("strategy") as Strategy | undefined,
        download: !!formData.get("download"),
        jsonFormat: !!formData.get("json"),
        useCache: formData.get("cache") !== "false", // Default true
    };
}

/**
 * Parse URL search params to conversion options
 */
export function parseQueryOptions(searchParams: URLSearchParams): ConversionOptions {
    return {
        bypass: searchParams.get("bypass") === "true",
        preserveImages: searchParams.get("images") !== "false",
        strategy: searchParams.get("strategy") as Strategy | undefined,
        download: false,
        jsonFormat: searchParams.get("format") === "json",
        useCache: searchParams.get("cache") !== "false",
    };
}
