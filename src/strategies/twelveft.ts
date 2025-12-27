/**
 * 12ft.io Strategy
 * Uses 12ft.io proxy to bypass paywalls
 */

import type { FetchResult } from "./googlebot.ts";

const TWELVEFT_PROXY = "https://12ft.io/proxy?q=";

export async function fetchWith12ft(url: string): Promise<FetchResult> {
    const proxyUrl = `${TWELVEFT_PROXY}${encodeURIComponent(url)}`;

    try {
        const response = await fetch(proxyUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Referer": "https://12ft.io/",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `12ft.io error: ${response.status} ${response.statusText}`,
                strategy: "12ft",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type from 12ft: ${contentType}`,
                strategy: "12ft",
            };
        }

        const html = await response.text();

        // Quick check for common error indicators
        if (html.includes("Rate limit exceeded") || html.includes("blocked")) {
            return {
                success: false,
                error: "12ft.io rate limited or blocked",
                strategy: "12ft",
            };
        }

        return {
            success: true,
            html,
            strategy: "12ft",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "12ft",
        };
    }
}
