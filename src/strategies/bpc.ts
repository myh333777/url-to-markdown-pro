/**
 * Server-compatible request profiles derived from Bypass Paywalls Clean.
 *
 * Only request-header rules that work without a browser are included here.
 * Browser-only script blocking, DOM rewriting, and cookie manipulation stay
 * out of the default URL2MD path.
 */

import { decodeResponse } from "../utils.ts";
import type { FetchResult } from "./googlebot.ts";

interface BpcRequestProfile {
    domains: string[];
    userAgent: string;
    headers?: Record<string, string>;
}

const PROFILES: BpcRequestProfile[] = [
    {
        domains: ["economist.com"],
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.103 Mobile Safari/537.36 Liskov",
    },
];

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getProfile(url: string): BpcRequestProfile | null {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return PROFILES.find((profile) =>
            profile.domains.some((domain) => matchesDomain(hostname, domain))
        ) || null;
    } catch {
        return null;
    }
}

export function hasBpcRequestProfile(url: string): boolean {
    return getProfile(url) !== null;
}

export async function fetchWithBpcProfile(
    url: string,
    signal?: AbortSignal,
): Promise<FetchResult> {
    const profile = getProfile(url);
    if (!profile) {
        return {
            success: false,
            error: "No server-compatible BPC profile for this domain",
            strategy: "bpc",
        };
    }

    try {
        const response = await fetch(url, {
            signal,
            headers: {
                "User-Agent": profile.userAgent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                ...profile.headers,
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "bpc",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "bpc",
            };
        }

        return {
            success: true,
            html: await decodeResponse(response),
            strategy: "bpc",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "bpc",
        };
    }
}
