const GOOGLE_NEWS_BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const GOOGLE_NEWS_TIMEOUT_MS = 2200;
const GOOGLE_NEWS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GOOGLE_NEWS_CACHE_MAX = 1000;

const decodedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function getArticleId(sourceUrl: string): string | null {
    try {
        const url = new URL(sourceUrl);
        if (url.hostname !== "news.google.com") return null;
        const match = url.pathname.match(/\/(?:articles|read)\/([^/?]+)/);
        return match?.[1] || null;
    } catch {
        return null;
    }
}
function decodeBase64Url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeLegacyArticleId(id: string): string | null {
    try {
        let bytes = decodeBase64Url(id);
        const prefix = [0x08, 0x13, 0x22];
        if (prefix.every((value, index) => bytes[index] === value)) {
            bytes = bytes.slice(prefix.length);
        }

        const suffix = [0xd2, 0x01, 0x00];
        if (
            bytes.length >= suffix.length &&
            suffix.every((value, index) => bytes[bytes.length - suffix.length + index] === value)
        ) {
            bytes = bytes.slice(0, -suffix.length);
        }

        if (bytes.length < 2) return null;

        let length = 0;
        let shift = 0;
        let offset = 0;
        while (offset < bytes.length && shift <= 28) {
            const byte = bytes[offset++];
            length |= (byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }

        if (!length || offset + length > bytes.length) return null;
        const decoded = new TextDecoder().decode(bytes.slice(offset, offset + length));
        return /^https?:\/\//.test(decoded) ? decoded : null;
    } catch {
        return null;
    }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_NEWS_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function buildBatchBody(id: string, timestamp: string, signature: string): string {
    const request = [
        [
            [
                "Fbv4je",
                JSON.stringify([
                    "garturlreq",
                    [
                        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
                        "X",
                        "X",
                        1,
                        [1, 1, 1],
                        1,
                        1,
                        null,
                        0,
                        0,
                        null,
                        0,
                    ],
                    id,
                    timestamp,
                    signature,
                ]),
            ],
        ],
    ];
    return `f.req=${encodeURIComponent(JSON.stringify(request))}`;
}

function extractExternalUrl(raw: string): string | null {
    // Current Fbv4je responses are XSSI-prefixed JSON. Parse the response
    // structurally so escaped query separators such as `\\u003d` do not
    // truncate URLs (for example ABC News `?id=...` links).
    const jsonStart = raw.indexOf("[[");
    if (jsonStart !== -1) {
        try {
            const payload = JSON.parse(raw.slice(jsonStart));
            for (const item of payload) {
                if (
                    Array.isArray(item) &&
                    item[0] === "wrb.fr" &&
                    item[1] === "Fbv4je" &&
                    typeof item[2] === "string"
                ) {
                    const decoded = JSON.parse(item[2]);
                    if (Array.isArray(decoded) && decoded[0] === "garturlres") {
                        for (const value of decoded.slice(1)) {
                            if (typeof value !== "string" || !/^https?:\/\//.test(value)) continue;
                            const parsed = new URL(value);
                            if (!parsed.hostname.endsWith("google.com")) return parsed.toString();
                        }
                    }
                }
            }
        } catch {
            // Fall through to the legacy regex parser for older response shapes.
        }
    }

    const matches = raw.match(/https?:\/\/[^\\"]+/g) || [];
    for (const match of matches) {
        const candidate = match
            .replace(/\\u003d/g, "=")
            .replace(/\\u0026/g, "&")
            .replace(/\\\//g, "/");
        try {
            const parsed = new URL(candidate);
            if (!parsed.hostname.endsWith("google.com")) return parsed.toString();
        } catch {
            // Ignore malformed candidates and keep scanning.
        }
    }
    return null;
}

function getCachedUrl(id: string): string | null {
    const cached = decodedUrlCache.get(id);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        decodedUrlCache.delete(id);
        return null;
    }
    return cached.url;
}

function setCachedUrl(id: string, url: string): void {
    if (decodedUrlCache.size >= GOOGLE_NEWS_CACHE_MAX) {
        const oldestKey = decodedUrlCache.keys().next().value;
        if (oldestKey) decodedUrlCache.delete(oldestKey);
    }
    decodedUrlCache.set(id, { url, expiresAt: Date.now() + GOOGLE_NEWS_CACHE_TTL_MS });
}

export async function decodeGoogleNewsUrl(sourceUrl: string): Promise<string | null> {
    const id = getArticleId(sourceUrl);
    if (!id) return null;

    const cached = getCachedUrl(id);
    if (cached) return cached;

    const legacyUrl = decodeLegacyArticleId(id);
    if (legacyUrl) {
        setCachedUrl(id, legacyUrl);
        return legacyUrl;
    }

    const pageResponse = await fetchWithTimeout(sourceUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; URL2MD/2.5; +https://url2md.myh333777.deno.net)",
            "Accept-Language": "en-US,en;q=0.9",
        },
    });
    if (!pageResponse.ok) return null;

    const page = await pageResponse.text();
    const signature = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
    const pageId = page.match(/data-n-a-id="([^"]+)"/)?.[1] || id;
    if (!signature || !timestamp) return null;

    const batchResponse = await fetchWithTimeout(GOOGLE_NEWS_BATCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Referer": "https://news.google.com/",
            "User-Agent": "Mozilla/5.0 (compatible; URL2MD/2.5; +https://url2md.myh333777.deno.net)",
        },
        body: buildBatchBody(pageId, timestamp, signature),
    });
    if (!batchResponse.ok) return null;

    const decodedUrl = extractExternalUrl(await batchResponse.text());
    if (decodedUrl) setCachedUrl(id, decodedUrl);
    return decodedUrl;
}
