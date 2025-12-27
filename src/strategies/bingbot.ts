import { decodeResponse } from "../utils.ts";

/**
 * Bingbot Strategy
 * Mimics Bing crawler to bypass paywalls
 */

export interface FetchResult {
    success: boolean;
    html?: string;
    error?: string;
    strategy: string;
}

const BINGBOT_USER_AGENTS = [
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/120.0.0.0 Safari/537.36",
];

// Bing IP ranges for X-Forwarded-For
const BING_IPS = [
    "157.55.39.1",
    "157.55.39.2",
    "157.55.39.10",
    "40.77.167.1",
    "40.77.167.2",
    "207.46.13.1",
    "207.46.13.2",
];

function getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export async function fetchWithBingbot(url: string): Promise<FetchResult> {
    const userAgent = getRandomItem(BINGBOT_USER_AGENTS);
    const forwardedIP = getRandomItem(BING_IPS);

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": userAgent,
                "X-Forwarded-For": forwardedIP,
                "Referer": "https://www.bing.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "bingbot",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "bingbot",
            };
        }

        const html = await decodeResponse(response);
        return {
            success: true,
            html,
            strategy: "bingbot",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "bingbot",
        };
    }
}
