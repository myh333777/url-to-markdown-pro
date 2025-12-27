import { decodeResponse } from "../utils.ts";

/**
 * Facebook External Hit Strategy
 * Mimics Facebook crawler to bypass paywalls
 */

export interface FetchResult {
    success: boolean;
    html?: string;
    error?: string;
    strategy: string;
}

const FACEBOOK_USER_AGENTS = [
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "facebookexternalhit/1.1",
    "Facebot",
];

function getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export async function fetchWithFacebookbot(url: string): Promise<FetchResult> {
    const userAgent = getRandomItem(FACEBOOK_USER_AGENTS);

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": userAgent,
                "Referer": "https://www.facebook.com/",
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
                strategy: "facebookbot",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "facebookbot",
            };
        }

        const html = await decodeResponse(response);
        return {
            success: true,
            html,
            strategy: "facebookbot",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "facebookbot",
        };
    }
}
