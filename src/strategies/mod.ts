// @ts-nocheck
/**
 * Multi-Strategy Fetcher Module (Enhanced)
 * Provides parallel fetch with cascade fallback
 * 
 * Enhancements:
 * - Parallel racing with Promise.race()
 * - Additional bot strategies (facebookbot, bingbot)
 * - Enhanced paywall/Cloudflare detection (20+ patterns)
 * - Exa AI via MCP (FREE, no API key required!)
 */

export { fetchWithGooglebot, type FetchResult } from "./googlebot.ts";
export { fetchFromArchive } from "./archive.ts";
export { fetchWith12ft } from "./twelveft.ts";
export { fetchWithJina, type JinaResult } from "./jina.ts";
export { fetchWithFacebookbot } from "./facebookbot.ts";
export { fetchWithBingbot } from "./bingbot.ts";
export { fetchWithExa } from "./exa.ts";

import { fetchWithGooglebot, type FetchResult } from "./googlebot.ts";
import { fetchFromArchive } from "./archive.ts";
import { fetchWith12ft } from "./twelveft.ts";
import { fetchWithJina, type JinaResult } from "./jina.ts";
import { fetchWithFacebookbot } from "./facebookbot.ts";
import { fetchWithBingbot } from "./bingbot.ts";
import { fetchWithExa } from "./exa.ts";

import { decodeResponse } from "../utils.ts";

export type Strategy = "direct" | "googlebot" | "facebookbot" | "bingbot" | "archive" | "12ft" | "jina" | "exa" | "googlenews";

export interface MultiStrategyResult {
    success: boolean;
    html?: string;
    markdown?: string;  // Only from Jina or Exa
    title?: string;
    strategy: Strategy;
    error?: string;
    attempts: Array<{ strategy: Strategy; error?: string }>;
    elapsed?: number;
}

// Parallel strategies (race for fastest success)
const PARALLEL_STRATEGIES: Strategy[] = ["direct", "googlebot", "facebookbot", "bingbot"];

// Fallback strategies (sequential)
const FALLBACK_STRATEGIES: Strategy[] = ["12ft", "archive", "jina", "exa"];

/**
 * Helper to decode response, handling GBK/GB2312 if detected
 */
async function decodeResponseWrapper(response: Response): Promise<string> {
    return await decodeResponse(response);
}

/**
 * Clean Jina/Exa output (remove metadata headers)
 */
function cleanMarkdown(markdown: string): string {
    if (!markdown) return "";

    // Remove Jina/Reader headers (Title: ... URL Source: ... Markdown Content:)
    const contentMarker = "Markdown Content:";
    const markerIndex = markdown.indexOf(contentMarker);
    if (markerIndex !== -1 && markerIndex < 500) { // Only if at start
        return markdown.slice(markerIndex + contentMarker.length).trim();
    }
    return markdown;
}

/**
 * Fetch with direct request (no bypass)
 */
async function fetchDirect(url: string): Promise<FetchResult> {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}`,
                strategy: "direct",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "direct",
            };
        }

        const html = await decodeResponseWrapper(response);

        // Check for blocks and paywalls
        if (isBlocked(html)) {
            return {
                success: false,
                error: "Blocked by Cloudflare or anti-bot",
                strategy: "direct",
            };
        }

        if (isPaywalled(html)) {
            return {
                success: false,
                error: "Paywall detected",
                strategy: "direct",
            };
        }

        return {
            success: true,
            html,
            strategy: "direct",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "direct",
            // @ts-ignore
            fallback: true
        };
    }
}

/**
 * Enhanced Cloudflare/anti-bot detection (20+ patterns)
 */
function isBlocked(html: string): boolean {
    const blockedPatterns = [
        /sorry,?\s*you have been blocked/i,
        /you are unable to access/i,
        /cloudflare ray id/i,
        /enable cookies/i,
        /checking your browser/i,
        /please wait while we check/i,
        /security check/i,
        /just a moment/i,
        /one more step/i,
        /completing the captcha/i,
        /access denied/i,
        /403 forbidden/i,
        /robot check/i,
        /captcha/i,
        /are you a robot/i,
        /prove you're human/i,
        /please verify you are/i,
        /please verify you are/i,
        /opening this page/i, // Google News client-side redirect
        /<title>Google News<\/title>/i,
    ];

    const text = html.slice(0, 5000).toLowerCase();
    return blockedPatterns.some(pattern => pattern.test(text));
}

/**
 * Enhanced paywall detection
 */
function isPaywalled(html: string): boolean {
    const paywallPatterns = [
        /class="[^"]*paywall[^"]*"/i,
        /id="[^"]*paywall[^"]*"/i,
        /subscribe.{0,20}to.{0,20}continue/i,
        /sign.{0,10}up.{0,20}to.{0,20}read/i,
        /premium.{0,20}content/i,
        /members?.{0,10}only/i,
        /login.{0,20}to.{0,20}view/i,
        /data-paywall/i,
        /this article is for subscribers/i,
        /you've reached your limit/i,
        /create.{0,10}an.{0,10}account/i,
        /start your free trial/i,
    ];

    const text = html.slice(0, 10000);
    return paywallPatterns.some(pattern => pattern.test(text));
}

/**
 * Detect Google Search error/redirect pages (invalid content)
 */
function isGoogleErrorPage(html: string): boolean {
    const errorPatterns = [
        /If you're having trouble accessing Google Search/i,
        /click here.*send feedback/i,
        /<title>Google Search<\/title>/i,
        /emsg=SG_REL/i,  // Google's error redirect parameter
    ];

    const text = html.slice(0, 3000);
    return errorPatterns.some(pattern => pattern.test(text));
}

/**
 * Execute a single strategy fetch
 */
async function executeStrategy(url: string, strategy: Strategy): Promise<FetchResult | JinaResult | any> {
    switch (strategy) {
        case "direct":
            return await fetchDirect(url);
        case "googlebot":
            return await fetchWithGooglebot(url);
        case "facebookbot":
            return await fetchWithFacebookbot(url);
        case "bingbot":
            return await fetchWithBingbot(url);
        case "archive":
            return await fetchFromArchive(url);
        case "12ft":
            return await fetchWith12ft(url);
        case "jina": {
            const result = await fetchWithJina(url);
            if (result.success && result.markdown) {
                // Remove Jina metadata headers
                result.markdown = result.markdown.replace(/^Title:[\s\S]*?Markdown Content:\n+/i, "");
            }
            return result;
        }
        case "exa": {
            const result = await fetchWithExa(url);
            if (result.success && result.markdown) {
                // Remove Exa/Jina-style metadata if any (Exa usually clean, but just in case)
                result.markdown = result.markdown.replace(/^Title:[\s\S]*?Markdown Content:\n+/i, "");
            }
            return result;
        }
        case "googlenews":
            // @ts-ignore
            const { fetchWithGoogleNews } = await import("./googlenews.ts");
            return await fetchWithGoogleNews(url);
        default:
            return { success: false, error: "Unknown strategy", strategy: "direct" };
    }
}

/**
 * Parallel fetch - race multiple strategies
 */
async function fetchParallel(url: string, strategies: Strategy[]): Promise<FetchResult | JinaResult | null> {
    const promises = strategies.map(async (strategy) => {
        const result = await executeStrategy(url, strategy);

        // Jina returns markdown, accept it if it has content
        if ("markdown" in result && result.markdown && result.markdown.length > 100) {
            return result;
        }

        // HTML based strategies
        const html = "html" in result ? result.html || "" : "";
        console.log(`[Strategy:${strategy}] Success: ${result.success}, Length: ${html.length}`);
        if (result.success && !isBlocked(html) && !isPaywalled(html) && !isGoogleErrorPage(html)) {
            // SPA detection: If HTML is too short, it's likely a shell. 
            // Reject it so Promise.any waits for better strategies (like Jina).
            if (html.length < 10000) { // Increased to 10k to be safe for modern sites
                throw new Error("Content likely incomplete (SPA shell)");
            }
            return result;
        }
        throw new Error(result.error || "Failed");
    });

    try {
        // Return the first successful result
        return await Promise.any(promises);
    } catch {
        // All failed
        return null;
    }
}

/**
 * Parallel fetch for fallback strategies (12ft, archive, jina, exa)
 * These strategies are slower but more reliable, so we race them too
 * No HTML length check since Jina/Exa return markdown directly
 */
async function fetchParallelFallback(url: string, strategies: Strategy[]): Promise<FetchResult | JinaResult | null> {
    const promises = strategies.map(async (strategy) => {
        const result = await executeStrategy(url, strategy);

        // Markdown-based strategies (Jina, Exa)
        if ("markdown" in result && result.markdown && result.markdown.length > 100) {
            console.log(`[Fallback:${strategy}] Markdown success, Length: ${result.markdown.length}`);
            return result;
        }

        // HTML-based strategies (12ft, archive)
        if ("html" in result && result.html && result.html.length > 1000) {
            if (result.success && !isBlocked(result.html) && !isPaywalled(result.html) && !isGoogleErrorPage(result.html)) {
                console.log(`[Fallback:${strategy}] HTML success, Length: ${result.html.length}`);
                return result;
            }
        }

        throw new Error(result.error || "Failed");
    });

    try {
        return await Promise.any(promises);
    } catch {
        return null;
    }
}

/**
 * Multi-strategy fetch with parallel racing + sequential fallback
 */
export async function fetchWithStrategies(
    url: string,
    options: { bypass: boolean; strategy?: Strategy }
): Promise<MultiStrategyResult> {
    const { strategy } = options;
    let { bypass } = options;
    const startTime = Date.now();
    const attempts: Array<{ strategy: Strategy; error?: string }> = [];

    // If specific strategy requested, use it directly (bypass parallel race)
    if (strategy && strategy !== "custom" && strategy !== "auto") {
        console.log(`[Fetch] Using explicit strategy: ${strategy}`);
        const result = await executeStrategy(url, strategy);
        attempts.push({ strategy, error: result.error });
        return createResult(result, strategy, attempts, startTime);
    }

    // Auto-detect Google News URL
    if (url.includes("news.google.com") || url.includes("/rss/articles/")) {
        console.log(`[Fetch] Auto-detected Google News URL`);

        // Try Archive.org first - most reliable for Google News redirects
        console.log(`[Fetch] Trying Archive.org first for Google News...`);
        const archiveResult = await executeStrategy(url, "archive");
        attempts.push({ strategy: "archive", error: archiveResult.error });

        if (archiveResult.success && archiveResult.html && archiveResult.html.length > 10000) {
            console.log(`[Fetch] Archive.org succeeded for Google News`);
            return createResult(archiveResult, "archive", attempts, startTime);
        }

        // If Archive fails, try the decoder
        console.log(`[Fetch] Archive failed, trying googlenews decoder...`);
        const result = await executeStrategy(url, "googlenews");
        attempts.push({ strategy: "googlenews", error: result.error });

        // If successful, return immediately
        if (result.success) {
            return createResult(result, "googlenews", attempts, startTime);
        }

        console.log(`[Fetch] Google News decoder failed, enabling bypass to try remaining fallbacks...`);
        bypass = true; // Force bypass to skip simple direct fetch
    }


    // If bypass mode is off, only try direct
    if (!bypass) {
        const result = await fetchDirect(url);
        attempts.push({ strategy: "direct", error: result.error });

        return createResult(result, "direct", attempts, startTime);
    }

    // 1. Parallel race for bot strategies
    // Skip if Google News strategy failed (bots can't handle the JS redirect)
    let parallelResult = null;
    if (!url.includes("news.google.com")) {
        console.log(`[Fetch] Starting parallel race for: ${url}`);
        parallelResult = await fetchParallel(url, PARALLEL_STRATEGIES);
    } else {
        console.log(`[Fetch] Skipping bot race for Google News URL`);
    }

    if (parallelResult && parallelResult.success) {
        console.log(`[Fetch] Parallel success with: ${parallelResult.strategy}`);
        return createResult(parallelResult, parallelResult.strategy as Strategy, attempts, startTime);
    }

    // 2. Parallel race for fallback strategies (12ft, archive, jina, exa)
    console.log(`[Fetch] Primary parallel failed, starting fallback parallel race...`);
    const fallbackResult = await fetchParallelFallback(url, FALLBACK_STRATEGIES);

    if (fallbackResult && fallbackResult.success) {
        console.log(`[Fetch] Fallback parallel success with: ${fallbackResult.strategy}`);
        return createResult(fallbackResult, fallbackResult.strategy as Strategy, attempts, startTime);
    }

    console.log(`[Fetch] All strategies failed`);

    return {
        success: false,
        error: `All strategies failed. Attempts: ${attempts.map(a => `${a.strategy}: ${a.error}`).join("; ")}`,
        strategy: "direct",
        attempts,
        elapsed: Date.now() - startTime,
    };
}

// Re-export detection functions for external use
export { isBlocked, isPaywalled };

function createResult(
    result: any,
    strategy: Strategy,
    attempts: Array<{ strategy: Strategy; error?: string }>,
    startTime: number
): MultiStrategyResult {
    if ("markdown" in result) {
        return {
            success: result.success,
            markdown: result.markdown,
            title: result.title,
            strategy: strategy,
            attempts,
            elapsed: Date.now() - startTime,
            error: result.error,
        };
    }

    return {
        success: result.success,
        html: result.html,
        strategy: strategy,
        attempts,
        elapsed: Date.now() - startTime,
        error: result.error,
    };
}
