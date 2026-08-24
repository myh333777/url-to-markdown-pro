import { decodeResponse } from "../utils.ts";
import type { FetchResult } from "./googlebot.ts";

export async function fetchWithGoogleReferer(url: string, signal?: AbortSignal): Promise<FetchResult> {
    try {
        const response = await fetch(url, {
            signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.google.com/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "google-referer",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "google-referer",
            };
        }

        return {
            success: true,
            html: await decodeResponse(response),
            strategy: "google-referer",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "google-referer",
        };
    }
}
