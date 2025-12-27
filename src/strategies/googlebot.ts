/**
 * Googlebot User-Agent Strategy
 * Mimics Googlebot to bypass paywalls that allow search engine crawlers
 */

import { decodeResponse } from "../utils.ts";

// Google IP ranges for X-Forwarded-For spoofing
const GOOGLE_IPS = [
    "66.249.66.1",
    "66.249.66.2",
    "66.249.66.3",
    "66.249.66.4",
    "66.249.66.5",
    "66.249.79.1",
    "66.249.79.2",
    "66.249.79.3",
    "64.233.173.1",
    "64.233.173.2",
    "72.14.199.1",
    "72.14.199.2",
];

const GOOGLEBOT_USER_AGENTS = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0.0.0 Safari/537.36",
    "Googlebot-News",
];

function getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export interface FetchResult {
    success: boolean;
    html?: string;
    error?: string;
    strategy: string;
}

export async function fetchWithGooglebot(url: string): Promise<FetchResult> {
    const userAgent = getRandomItem(GOOGLEBOT_USER_AGENTS);
    const forwardedIP = getRandomItem(GOOGLE_IPS);

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": userAgent,
                "X-Forwarded-For": forwardedIP,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Cache-Control": "no-cache",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "googlebot",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "googlebot",
            };
        }

        const html = await decodeResponse(response);
        return {
            success: true,
            html,
            strategy: "googlebot",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "googlebot",
        };
    }
}
