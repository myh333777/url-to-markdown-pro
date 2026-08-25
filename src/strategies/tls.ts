import type { FetchResult } from "./googlebot.ts";

interface TlsProfile {
    domains: string[];
    browser: "firefox_135";
    os: "windows";
}

const PROFILES: TlsProfile[] = [
    {
        domains: ["science.org"],
        browser: "firefox_135",
        os: "windows",
    },
];

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function getProfile(url: string): TlsProfile | null {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return PROFILES.find((profile) =>
            profile.domains.some((domain) => matchesDomain(hostname, domain))
        ) || null;
    } catch {
        return null;
    }
}

/**
 * Fetch with a real-browser TLS/HTTP2 fingerprint without launching Chromium.
 * Keep this allowlisted: only domains verified to benefit from a specific
 * fingerprint should pay the native-addon load cost.
 */
export async function fetchWithTlsProfile(
    url: string,
    signal?: AbortSignal,
): Promise<FetchResult> {
    const profile = getProfile(url);
    if (!profile) {
        return {
            success: false,
            error: "No TLS impersonation profile for this domain",
            strategy: "tls",
        };
    }

    try {
        const { fetch: fingerprintFetch } = await import("npm:wreq-js@3.2.0");
        const response = await fingerprintFetch(url, {
            browser: profile.browser,
            os: profile.os,
            timeout: 8000,
            signal,
        });

        if (response.status < 200 || response.status >= 400) {
            return {
                success: false,
                error: `HTTP ${response.status}`,
                strategy: "tls",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "tls",
            };
        }

        return {
            success: true,
            html: await response.text(),
            strategy: "tls",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "tls",
        };
    }
}
