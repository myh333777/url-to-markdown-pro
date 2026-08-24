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
    type FetchResponse,
} from "../utils.ts";
import type { Strategy } from "../strategies/mod.ts";
import { extractFromJsonLd } from "../jsonld.ts";

// ============== URL Cache (DISABLED) ==============
// Cache is disabled per user request
const urlCache = new Map<string, { data: CacheEntry; timestamp: number }>();
const inFlightConversions = new Map<string, Promise<ConversionResult>>();

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
    resolvedUrl?: string;
    quality?: number;
    timings?: {
        fetch: number;
        extract: number;
        total: number;
    };
}

function normalizeUrl(url: string): string {
    try {
        return new URL(url).toString();
    } catch {
        return url;
    }
}

function getConversionKey(url: string, options: ConversionOptions): string {
    return JSON.stringify([
        normalizeUrl(url),
        options.bypass,
        options.preserveImages,
        options.strategy || "auto",
        options.jsonFormat,
    ]);
}

function stripMarkdown(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<https?:\/\/[^>]+>/g, " ")
        .replace(/[`#>*_~|=-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function assessContentQuality(markdown: string): number {
    const lower = markdown.toLowerCase();
    const invalidPatterns = [
        /client challenge/i,
        /a required part of this site couldn.?t load/i,
        /performing security verification/i,
        /unusual activity from your computer network/i,
        /data mine or scrape the content using automated means/i,
        /text and data mining activities/i,
        /subscribe.{0,30}to.{0,30}unlock/i,
        /subscribe.{0,30}to.{0,30}continue/i,
        /unlock unlimited access/i,
        /this article is for subscribers/i,
        /you.?ve reached your limit/i,
    ];
    if (invalidPatterns.some((pattern) => pattern.test(lower))) return 0;

    const plain = stripMarkdown(markdown);
    const textLength = plain.length;
    if (textLength < 100) return 0;

    let score = textLength >= 1500 ? 50 : textLength >= 700 ? 42 : textLength >= 350 ? 34 : 20;
    if (/^#\s+\S/m.test(markdown)) score += 10;

    const paragraphs = markdown.split(/\n\s*\n/).filter((part) => stripMarkdown(part).length >= 40).length;
    score += Math.min(20, paragraphs * 4);

    const links = [...markdown.matchAll(/\[([^\]]+)\]\([^)]+\)/g)];
    const linkedTextLength = links.reduce((sum, match) => sum + (match[1]?.length || 0), 0);
    const linkRatio = textLength > 0 ? linkedTextLength / textLength : 1;
    if (linkRatio < 0.35) score += 10;
    else if (linkRatio > 0.7) score -= 25;

    return Math.max(0, Math.min(100, score));
}

function requireQuality(markdown: string): number {
    const quality = assessContentQuality(markdown);
    if (quality < 30) {
        throw new ContentQualityError(`Extracted content failed quality check (score ${quality})`);
    }
    return quality;
}

class ContentQualityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ContentQualityError";
    }
}

async function convertFetchedContent(
    sourceUrl: string,
    fetchResult: FetchResponse,
    options: ConversionOptions,
): Promise<{ result: CacheEntry; quality: number }> {
    const { preserveImages, jsonFormat } = options;

    if (fetchResult.markdown) {
        const quality = requireQuality(fetchResult.markdown);
        if (jsonFormat) {
            const jsonData = {
                url: sourceUrl,
                title: "Extracted Content",
                date: new Date().toISOString(),
                content: fetchResult.markdown,
                strategy: fetchResult.strategy,
                elapsed: fetchResult.elapsed,
            };
            return {
                quality,
                result: {
                    content: JSON.stringify(jsonData, null, 2),
                    strategy: fetchResult.strategy,
                    contentType: "application/json",
                },
            };
        }
        return {
            quality,
            result: {
                content: fetchResult.markdown,
                strategy: fetchResult.strategy,
                contentType: "text/plain; charset=utf-8",
            },
        };
    }

    if (!fetchResult.html) {
        throw new ContentQualityError("No content received from fetch");
    }

    const jsonLd = extractFromJsonLd(fetchResult.html);
    if (jsonLd && jsonLd.content.length > 500) {
        console.log(`[JSON-LD] Using structured data for: ${sourceUrl}`);
        let markdown = `# ${jsonLd.title}\n\n`;
        if (jsonLd.author) markdown += `*By ${jsonLd.author}*\n\n`;
        markdown += jsonLd.content;
        const quality = requireQuality(markdown);

        if (jsonFormat) {
            const jsonData = {
                url: sourceUrl,
                title: jsonLd.title,
                date: jsonLd.date || new Date().toISOString(),
                content: markdown,
                strategy: fetchResult.strategy,
                author: jsonLd.author,
            };
            return {
                quality,
                result: {
                    content: JSON.stringify(jsonData, null, 2),
                    strategy: fetchResult.strategy,
                    contentType: "application/json",
                    title: jsonLd.title,
                },
            };
        }

        return {
            quality,
            result: {
                content: markdown,
                strategy: fetchResult.strategy,
                contentType: "text/plain; charset=utf-8",
                title: jsonLd.title,
            },
        };
    }

    if (jsonFormat) {
        const jsonContent = generateJsonData(
            fetchResult.html,
            sourceUrl,
            fetchResult.strategy,
            preserveImages,
        );
        const parsed = JSON.parse(jsonContent);
        const quality = requireQuality(String(parsed.content || ""));
        return {
            quality,
            result: {
                content: jsonContent,
                strategy: fetchResult.strategy,
                contentType: "application/json",
                title: parsed.title,
            },
        };
    }

    const markdown = generateMarkdownText(fetchResult.html, preserveImages, sourceUrl);
    const quality = requireQuality(markdown);
    return {
        quality,
        result: {
            content: markdown,
            strategy: fetchResult.strategy,
            contentType: "text/plain; charset=utf-8",
        },
    };
}

/**
 * Handle URL to Markdown conversion
 */
async function performConversion(url: string, options: ConversionOptions): Promise<ConversionResult> {
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
    const fetchStartedAt = Date.now();
    let fetchResult = await fetchHtmlWithStrategies(url, {
        bypass,
        strategy,
    });
    let fetchElapsed = Date.now() - fetchStartedAt;

    if (!fetchResult.success) {
        throw new Error(fetchResult.error || "Failed to fetch content");
    }

    let extractElapsed = 0;
    const convertTimed = async (
        sourceUrl: string,
        candidate: FetchResponse,
    ): Promise<{ result: CacheEntry; quality: number }> => {
        const startedAt = Date.now();
        try {
            return await convertFetchedContent(sourceUrl, candidate, options);
        } finally {
            extractElapsed += Date.now() - startedAt;
        }
    };
    let converted: { result: CacheEntry; quality: number };
    try {
        converted = await convertTimed(url, fetchResult);
    } catch (error) {
        const strategyValue = strategy as string | undefined;
        const explicitStrategy = Boolean(
            strategyValue && strategyValue !== "auto" && strategyValue !== "custom",
        );
        if (!(error instanceof ContentQualityError) || explicitStrategy) throw error;

        const rescueUrl = fetchResult.resolvedUrl || url;
        let rescued: { result: CacheEntry; quality: number } | null = null;
        for (const rescueStrategy of ["jina", "exa"] as const) {
            if (fetchResult.strategy === rescueStrategy) continue;
            const rescueStartedAt = Date.now();
            const candidate = await fetchHtmlWithStrategies(rescueUrl, {
                bypass: true,
                strategy: rescueStrategy,
            });
            fetchElapsed += Date.now() - rescueStartedAt;
            if (!candidate.success) continue;
            candidate.resolvedUrl = fetchResult.resolvedUrl;
            try {
                rescued = await convertTimed(rescueUrl, candidate);
                fetchResult = candidate;
                break;
            } catch (candidateError) {
                if (!(candidateError instanceof ContentQualityError)) throw candidateError;
            }
        }
        if (!rescued) throw error;
        converted = rescued;
    }

    const { result, quality } = converted;

    // Save to cache
    if (useCache) {
        setCache(url, result);
    }

    return {
        ...result,
        elapsed: Date.now() - startTime,
        fromCache: false,
        resolvedUrl: fetchResult.resolvedUrl,
        quality,
        timings: {
            fetch: fetchElapsed,
            extract: extractElapsed,
            total: Date.now() - startTime,
        },
    };
}

export async function handleConversion(url: string, options: ConversionOptions): Promise<ConversionResult> {
    const key = getConversionKey(url, options);
    const existing = inFlightConversions.get(key);
    if (existing) return await existing;

    const promise = performConversion(url, options);
    inFlightConversions.set(key, promise);
    try {
        return await promise;
    } finally {
        if (inFlightConversions.get(key) === promise) {
            inFlightConversions.delete(key);
        }
    }
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
