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
export { fetchWithGoogleReferer } from "./google-referer.ts";
export { fetchWithBpcProfile } from "./bpc.ts";
export { fetchWithWreq } from "./wreq.ts";

import { fetchWithGooglebot, type FetchResult } from "./googlebot.ts";
import { fetchFromArchive } from "./archive.ts";
import { fetchWith12ft } from "./twelveft.ts";
import { fetchWithJina, type JinaResult } from "./jina.ts";
import { fetchWithFacebookbot } from "./facebookbot.ts";
import { fetchWithBingbot } from "./bingbot.ts";
import { fetchWithExa } from "./exa.ts";
import { fetchWithGoogleReferer } from "./google-referer.ts";
import { fetchWithBpcProfile, hasBpcRequestProfile } from "./bpc.ts";
import { getSiteRoute } from "./site-router.ts";
import { decodeGoogleNewsUrl } from "./google-news-decoder.ts";

import { decodeResponse } from "../utils.ts";

export type Strategy = "direct" | "bpc" | "wreq" | "googlebot" | "facebookbot" | "bingbot" | "google-referer" | "archive" | "12ft" | "jina" | "exa" | "googlenews";

export interface MultiStrategyResult {
    success: boolean;
    html?: string;
    markdown?: string;  // Only from Jina or Exa
    title?: string;
    resolvedUrl?: string;
    strategy: Strategy;
    error?: string;
    attempts: Array<{ strategy: Strategy; error?: string }>;
    elapsed?: number;
}

/**
 * Helper to decode response, handling GBK/GB2312 if detected
 */
async function decodeResponseWrapper(response: Response): Promise<string> {
    return await decodeResponse(response);
}

const PRIMARY_HEDGE_DELAY_MS = 180;
const FALLBACK_HEDGE_DELAY_MS = 180;
const FALLBACK_TIMEOUT_MS = 8000;

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
async function fetchDirect(url: string, signal?: AbortSignal): Promise<FetchResult> {
    try {
        const response = await fetch(url, {
            signal,
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
        /are you a robot/i,
        /prove you're human/i,
        /please verify you are/i,
        /performing security verification/i,
        /unusual activity from your computer network/i,
        /data mine or scrape the content using automated means/i,
        /text and data mining activities/i,
        /content is made available for your personal, non-commercial use/i,
        /client challenge/i,
        /a required part of this site couldn.?t load/i,
        /opening this page/i, // Google News client-side redirect
        /<title>Google News<\/title>/i,
    ];

    // Challenge pages usually identify themselves near the beginning, while
    // some publishers append anti-automation notices at the very end of an
    // otherwise large HTML document. Check both bounded edges instead of
    // scanning megabytes of markup on every strategy attempt.
    const text = `${html.slice(0, 10000)}\n${html.slice(-30000)}`.toLowerCase();
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
        /premium\s+(?:article|content)/i,
        /members?.{0,10}only/i,
        /login.{0,20}to.{0,20}view/i,
        /data-paywall/i,
        /this article is for subscribers/i,
        /you've reached your limit/i,
        /create.{0,10}an.{0,10}account/i,
        /start your free trial/i,
        /subscribe.{0,20}to.{0,20}unlock/i,
        /create.{0,30}account.{0,20}to.{0,20}unlock/i,
        /unlock unlimited access/i,
        /get full access.{0,80}(journalism|article)/i,
    ];

    // Reader services can prepend long navigation blocks before the actual
    // subscription barrier. Scan a wider bounded prefix so those pages are
    // not mistaken for full articles.
    const text = html.slice(0, 50000);
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

function isLikelyUsefulHtml(html: string): boolean {
    if (!html || html.length < 300) return false;
    if (/<article\b/i.test(html)) return true;
    if (/"@type"\s*:\s*"(?:NewsArticle|Article|ReportageNewsArticle|BlogPosting)"/i.test(html)) return true;

    const sample = html.slice(0, 250000)
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    return sample.length >= 100;
}

function isReutersUrl(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname === "reuters.com" || hostname.endsWith(".reuters.com");
    } catch {
        return false;
    }
}

function isBloombergUrl(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname === "bloomberg.com" || hostname.endsWith(".bloomberg.com");
    } catch {
        return false;
    }
}

function getReutersSearchTitle(url: string): string | null {
    try {
        const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
        if (!slug) return null;
        return slug
            .replace(/-\d{4}-\d{2}-\d{2}$/, "")
            .replace(/-(\d)(\d)-/g, "-$1.$2-")
            .split("-")
            .filter(Boolean)
            .join(" ");
    } catch {
        return null;
    }
}

function getBloombergSearchTitle(url: string): string | null {
    try {
        const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
        if (!slug) return null;
        return slug.split("-").filter(Boolean).join(" ");
    } catch {
        return null;
    }
}

function decodeXmlText(value: string): string {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function titleTokens(value: string): Set<string> {
    const stopWords = new Set([
        "a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of",
        "on", "or", "report", "reports", "says", "the", "to", "with",
    ]);
    return new Set(
        value
            .toLowerCase()
            .replace(/[^a-z0-9.%]+/g, " ")
            .split(/\s+/)
            .filter((token) => token.length > 1 && !stopWords.has(token)),
    );
}

function titleCoverage(expected: string, candidate: string): number {
    const expectedTokens = titleTokens(expected);
    const candidateTokens = titleTokens(candidate.replace(/\s+-\s+[^-]+$/, ""));
    if (expectedTokens.size < 4 || candidateTokens.size < 4) return 0;
    let matches = 0;
    for (const token of expectedTokens) {
        if (candidateTokens.has(token)) matches += 1;
    }
    return matches / expectedTokens.size;
}

interface SyndicatedSpec {
    label: "Reuters" | "Bloomberg";
    title: string;
    isOriginalUrl: (url: string) => boolean;
    sourcePattern: RegExp;
}

function getSyndicatedSpec(url: string): SyndicatedSpec | null {
    if (isReutersUrl(url)) {
        const title = getReutersSearchTitle(url);
        return title
            ? {
                label: "Reuters",
                title,
                isOriginalUrl: isReutersUrl,
                sourcePattern: /\breuters\b/i,
            }
            : null;
    }

    if (isBloombergUrl(url)) {
        const title = getBloombergSearchTitle(url);
        return title
            ? {
                label: "Bloomberg",
                title,
                isOriginalUrl: isBloombergUrl,
                sourcePattern: /\bbloomberg\b/i,
            }
            : null;
    }

    return null;
}

function syndicatedSourceScore(spec: SyndicatedSpec, source: string): number {
    if (spec.label === "Bloomberg") {
        if (/yahoo|aol|straits times|daily gazette/i.test(source)) return 0;
        if (/tradingview|japan times/i.test(source)) return 1;
        return 2;
    }

    if (/yahoo|tradingview|forex factory|aol/i.test(source)) return 0;
    if (/bloomberg|wall street journal|financial times|economist|barron|marketwatch/i.test(source)) return 2;
    return 1;
}

function hasSyndicatedAttribution(
    spec: SyndicatedSpec,
    result: MultiStrategyResult,
): boolean {
    if (result.html) {
        const raw = result.html.slice(0, 1_500_000);
        if (spec.label === "Bloomberg") {
            if (/\(Bloomberg\)\s*(?:--|[-–—])/i.test(raw)) return true;
            if (/"provider"\s*:\s*\{[^}]{0,500}"name"\s*:\s*"Bloomberg"/i.test(raw)) return true;
            if (/<meta[^>]+name=["']author["'][^>]+content=["'][^"']*Bloomberg News/i.test(raw)) return true;
        } else {
            if (/\(Reuters\)\s*(?:--|[-–—])/i.test(raw)) return true;
            if (/<meta[^>]+name=["']author["'][^>]+content=["'][^"']*Reuters/i.test(raw)) return true;
        }
    }

    let text = result.markdown || "";
    if (!text && result.html) {
        text = result.html.slice(0, 250000)
            .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
    }
    text = text.slice(0, 12000);

    if (spec.label === "Bloomberg") {
        return /\(Bloomberg\)\s*--/i.test(text) ||
            /\bby\b.{0,240}\bBloomberg(?:\s+News)?\b/i.test(text);
    }
    return /\bby\b.{0,160}\bReuters\b/i.test(text) ||
        /\(Reuters\)\s*[-–—]/i.test(text);
}

async function fetchSyndicatedCopy(
    url: string,
    attempts: Array<{ strategy: Strategy; error?: string }>,
): Promise<MultiStrategyResult | null> {
    const spec = getSyndicatedSpec(url);
    if (!spec) return null;

    const query = encodeURIComponent(spec.title);
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    let xml = "";
    try {
        const response = await fetch(rssUrl, {
            signal: AbortSignal.timeout(2500),
            headers: { "User-Agent": "URL2MD/2.5" },
        });
        if (!response.ok) return null;
        xml = await response.text();
    } catch {
        return null;
    }

    const candidates = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
        .slice(0, 12)
        .map((match) => {
            const item = match[1];
            const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1];
            const itemTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
            const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "";
            return link
                ? {
                    link: decodeXmlText(link.trim()),
                    title: decodeXmlText(itemTitle.trim()),
                    source: decodeXmlText(source.trim()),
                }
                : null;
        })
        .filter((candidate): candidate is { link: string; title: string; source: string } => Boolean(candidate))
        .filter((candidate) => !spec.sourcePattern.test(candidate.source))
        .filter((candidate) => titleCoverage(spec.title, candidate.title) >= 0.65)
        .sort((a, b) => syndicatedSourceScore(spec, a.source) - syndicatedSourceScore(spec, b.source));

    for (const candidate of candidates) {
        let resolved: string | null = null;
        try {
            resolved = await decodeGoogleNewsUrl(candidate.link);
        } catch {
            continue;
        }
        if (!resolved || spec.isOriginalUrl(resolved)) continue;

        try {
            const result = await fetchWithStrategies(resolved, {
                bypass: true,
                strategy: undefined,
                allowSyndicated: false,
            });
            if (result.success && hasSyndicatedAttribution(spec, result)) {
                console.log(`[${spec.label}] Recovered via syndicated source: ${resolved}`);
                return {
                    ...result,
                    resolvedUrl: resolved,
                    attempts,
                };
            }
        } catch {
            // Try the next syndicated candidate.
        }
    }

    return null;
}

/**
 * Execute a single strategy fetch
 */
async function executeStrategy(
    url: string,
    strategy: Strategy,
    signal?: AbortSignal,
): Promise<FetchResult | JinaResult | any> {
    switch (strategy) {
        case "direct":
            return await fetchDirect(url, signal);
        case "bpc":
            return await fetchWithBpcProfile(url, signal);
        case "wreq": {
            const { fetchWithWreq } = await import("./wreq.ts");
            return await fetchWithWreq(url, signal);
        }
        case "googlebot":
            return await fetchWithGooglebot(url, signal);
        case "facebookbot":
            return await fetchWithFacebookbot(url, signal);
        case "bingbot":
            return await fetchWithBingbot(url, signal);
        case "google-referer":
            return await fetchWithGoogleReferer(url, signal);
        case "archive":
            return await fetchFromArchive(url);
        case "12ft":
            return await fetchWith12ft(url);
        case "jina": {
            const result = await fetchWithJina(url, signal);
            if (result.success && result.markdown) {
                // Remove Jina metadata headers
                result.markdown = result.markdown.replace(/^Title:[\s\S]*?Markdown Content:\n+/i, "");
            }
            return result;
        }
        case "exa": {
            const result = await fetchWithExa(url, signal);
            if (result.success && result.markdown) {
                // Remove Exa/Jina-style metadata if any (Exa usually clean, but just in case)
                result.markdown = result.markdown.replace(/^Title:[\s\S]*?Markdown Content:\n+/i, "");
            }
            return result;
        }
        case "googlenews":
            // @ts-ignore
            const { fetchWithGoogleNews } = await import("./googlenews-v2.ts");
            return await fetchWithGoogleNews(url);
        default:
            return { success: false, error: "Unknown strategy", strategy: "direct" };
    }
}

/**
 * Parallel fetch - race multiple strategies
 */
function recordAttempt(
    attempts: Array<{ strategy: Strategy; error?: string }> | undefined,
    strategy: Strategy,
    error?: string,
): void {
    attempts?.push({ strategy, error });
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function isTransientError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /(error sending request|fetch failed|network|connection|socket|reset|econn|temporar(?:y|ily) unavailable)/i.test(message);
}

function validateStrategyResult(
    result: FetchResult | JinaResult | any,
    strategy: Strategy,
): FetchResult | JinaResult | any {
    if (
        "markdown" in result &&
        result.markdown &&
        result.markdown.length > 100 &&
        !isBlocked(result.markdown) &&
        !isPaywalled(result.markdown) &&
        !isGoogleErrorPage(result.markdown)
    ) {
        return result;
    }

    const html = "html" in result ? result.html || "" : "";
    if (
        result.success &&
        html &&
        !isBlocked(html) &&
        !isPaywalled(html) &&
        !isGoogleErrorPage(html) &&
        isLikelyUsefulHtml(html)
    ) {
        return result;
    }

    throw new Error(result.error || `${strategy} rejected by content quality checks`);
}

async function executeValidatedStrategy(
    url: string,
    strategy: Strategy,
    signal: AbortSignal,
    retryTransient: boolean,
): Promise<FetchResult | JinaResult | any> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const result = await executeStrategy(url, strategy, signal);
            return validateStrategyResult(result, strategy);
        } catch (error) {
            if (
                attempt === 0 &&
                retryTransient &&
                !signal.aborted &&
                isTransientError(error)
            ) {
                await new Promise((resolve) => setTimeout(resolve, 60));
                continue;
            }
            throw error;
        }
    }
    throw new Error(`${strategy} failed`);
}

async function fetchHedged(
    url: string,
    strategies: Strategy[],
    attempts?: Array<{ strategy: Strategy; error?: string }>,
    hedgeDelayMs = PRIMARY_HEDGE_DELAY_MS,
    timeoutMs?: number,
): Promise<FetchResult | JinaResult | null> {
    if (strategies.length === 0) return null;

    return await new Promise((resolve) => {
        const controllers = strategies.map(() => new AbortController());
        let nextIndex = 0;
        let active = 0;
        let settled = false;
        let hedgeTimer: number | undefined;

        const finish = (result: FetchResult | JinaResult | null) => {
            if (settled) return;
            settled = true;
            if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
            for (const controller of controllers) controller.abort();
            resolve(result);
        };

        const scheduleNext = () => {
            if (settled || nextIndex >= strategies.length || hedgeTimer !== undefined) return;
            hedgeTimer = setTimeout(() => {
                hedgeTimer = undefined;
                startNext();
            }, hedgeDelayMs);
        };

        const startNext = () => {
            if (settled || nextIndex >= strategies.length) {
                if (!settled && active === 0) finish(null);
                return;
            }

            if (hedgeTimer !== undefined) {
                clearTimeout(hedgeTimer);
                hedgeTimer = undefined;
            }

            const index = nextIndex++;
            const strategy = strategies[index];
            const controller = controllers[index];
            const signal = timeoutMs
                ? AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
                : controller.signal;
            active += 1;

            executeValidatedStrategy(url, strategy, signal, timeoutMs === undefined)
                .then((result) => {
                    console.log(`[Strategy:${strategy}] Hedged success`);
                    finish(result);
                })
                .catch((error) => {
                    active -= 1;
                    if (!isAbortError(error)) {
                        const message = error instanceof Error ? error.message : String(error);
                        recordAttempt(attempts, strategy, message);
                    }
                    if (nextIndex < strategies.length) {
                        startNext();
                    } else if (active === 0) {
                        finish(null);
                    }
                });

            scheduleNext();
        };

        startNext();
    });
}

/**
 * Multi-strategy fetch with parallel racing + sequential fallback
 */
export async function fetchWithStrategies(
    url: string,
    options: { bypass: boolean; strategy?: Strategy; allowSyndicated?: boolean }
): Promise<MultiStrategyResult> {
    const { strategy } = options;
    const allowSyndicated = options.allowSyndicated !== false;
    let { bypass } = options;
    const startTime = Date.now();
    const attempts: Array<{ strategy: Strategy; error?: string }> = [];

    // If specific strategy requested, use it directly (bypass parallel race)
    if (strategy && strategy !== "custom" && strategy !== "auto") {
        console.log(`[Fetch] Using explicit strategy: ${strategy}`);
        const signal = ["wreq", "jina", "exa", "archive", "12ft"].includes(strategy)
            ? AbortSignal.timeout(FALLBACK_TIMEOUT_MS)
            : undefined;
        const result = await executeStrategy(url, strategy, signal);
        try {
            return createResult(validateStrategyResult(result, strategy), strategy, attempts, startTime);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            attempts.push({ strategy, error: message });
            return createResult({ success: false, error: message }, strategy, attempts, startTime);
        }
    }

    // Auto-detect Google News URL. Decode first; trying archive/bot strategies
    // against the Google wrapper only adds latency and cannot reveal the source.
    if (url.includes("news.google.com") || url.includes("/rss/articles/")) {
        console.log(`[Fetch] Auto-detected Google News URL`);
        const result = await executeStrategy(url, "googlenews");
        attempts.push({ strategy: "googlenews", error: result.error });

        // If successful, return immediately
        if (result.success) {
            return createResult(result, "googlenews", attempts, startTime);
        }

        console.log(`[Fetch] Google News resolution/fetch failed; stopping early`);
        return createResult(result, "googlenews", attempts, startTime);
    }


    // If bypass mode is off, only try direct
    if (!bypass) {
        const result = await fetchDirect(url);
        attempts.push({ strategy: "direct", error: result.error });

        // Check if direct result is a Google error page - if so, force bypass mode
        if (result.success && result.html) {
            if (isGoogleErrorPage(result.html) || isBlocked(result.html)) {
                console.log(`[Fetch] Direct returned Google error/blocked page, forcing bypass mode...`);
                bypass = true;
            } else {
                return createResult(result, "direct", attempts, startTime);
            }
        } else if (!result.success) {
            // Direct failed, try bypass mode
            console.log(`[Fetch] Direct failed, trying bypass mode...`);
            bypass = true;
        } else {
            return createResult(result, "direct", attempts, startTime);
        }
    }

    const route = getSiteRoute(url);

    // 1. Small, domain-aware primary race.
    console.log(`[Fetch] Primary route: ${route.primary.join(", ")}`);
    const parallelResult = await fetchHedged(
        url,
        route.primary as Strategy[],
        attempts,
        PRIMARY_HEDGE_DELAY_MS,
    );

    if (parallelResult && parallelResult.success) {
        console.log(`[Fetch] Parallel success with: ${parallelResult.strategy}`);
        return createResult(parallelResult, parallelResult.strategy as Strategy, attempts, startTime);
    }

    if (allowSyndicated && (isReutersUrl(url) || isBloombergUrl(url))) {
        const syndicatedResult = await fetchSyndicatedCopy(url, attempts);
        if (syndicatedResult?.success) {
            return {
                ...syndicatedResult,
                elapsed: Date.now() - startTime,
            };
        }
    }

    // BPC's pure-HTTP rules are a cheap secondary recovery layer. Do not race
    // them against a working public page: several publishers serve direct
    // requests normally but reject crawler/referer variants. Custom-UA rules
    // are already routed as primary by site-router.ts and are skipped here.
    if (!route.primary.includes("bpc") && hasBpcRequestProfile(url)) {
        console.log(`[Fetch] Primary route failed; trying BPC HTTP profile`);
        const bpcResult = await fetchHedged(url, ["bpc"], attempts, 0);
        if (bpcResult?.success) {
            console.log(`[Fetch] BPC HTTP profile succeeded`);
            return createResult(bpcResult, "bpc", attempts, startTime);
        }
    }

    // 2. One additional cheap crawler on misses. This recovers sites that
    // selectively admit a social crawler without paying the cost on normal hits.
    if (!route.primary.includes("facebookbot")) {
        console.log(`[Fetch] Primary route failed; trying cheap secondary: facebookbot`);
        const secondaryResult = await fetchHedged(url, ["facebookbot"], attempts, 0);
        if (secondaryResult && secondaryResult.success) {
            console.log(`[Fetch] Secondary success with: ${secondaryResult.strategy}`);
            return createResult(secondaryResult, secondaryResult.strategy as Strategy, attempts, startTime);
        }
    }

    // 3. Bounded two-provider fallback race. It runs only after the cheap
    // strategies fail, retaining most of the latency savings of the lean path
    // while avoiding systematic blind spots where Exa or Jina alone fails.
    console.log(`[Fetch] Primary route failed; fallback: ${route.fallback.join(", ")}`);
    const fallbackResult = await fetchHedged(
        url,
        route.fallback as Strategy[],
        attempts,
        FALLBACK_HEDGE_DELAY_MS,
        FALLBACK_TIMEOUT_MS,
    );

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
            resolvedUrl: result.resolvedUrl,
            strategy: strategy,
            attempts,
            elapsed: Date.now() - startTime,
            error: result.error,
        };
    }

    return {
        success: result.success,
        html: result.html,
        resolvedUrl: result.resolvedUrl,
        strategy: strategy,
        attempts,
        elapsed: Date.now() - startTime,
        error: result.error,
    };
}
