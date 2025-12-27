import {
    fetchWithStrategies,
    type Strategy,
    type MultiStrategyResult
} from "./strategies/mod.ts";

const MAX_HOSTNAME_LENGTH = 20;
const MAX_PATHNAME_LENGTH = 30;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB limit

/**
 * Generate filename from URL
 */
const generateFilename = (url: string, jsonFormat = false): string => {
    const { host, pathname } = new URL(url);

    let cleanedHost = host.replace(/www\.?/gi, "");
    cleanedHost = cleanedHost.replace(/[^a-z0-9]+/gi, "");
    cleanedHost = cleanedHost.slice(0, MAX_HOSTNAME_LENGTH);

    let cleanedPathname = pathname.replace(/^\//gi, "");
    cleanedPathname = cleanedPathname.replace(/[^a-z0-9]+/gi, "-");
    cleanedPathname = cleanedPathname.slice(0, MAX_PATHNAME_LENGTH);

    return `${cleanedHost}_${cleanedPathname}.${jsonFormat ? "json" : "md"}`;
};

/**
 * Legacy fetch function (simple direct fetch)
 */
const fetchHtmlText = async (url: string): Promise<string> => {
    try {
        const validUrl = new URL(url);
        const response = await fetch(validUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        const headResponse = await fetch(url, { method: "HEAD" });
        const contentLength = headResponse.headers.get("content-length");

        if (contentLength && parseInt(contentLength) > MAX_SIZE) {
            throw new Error("Content too large");
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get("Content-Type");
        if (!contentType || !contentType.includes("text/html")) {
            throw new Error("Invalid content type! Must be text/html");
        }

        const blob = await response.blob();
        if (blob.size > MAX_SIZE) {
            throw new Error(`Page too large. Maximum size is ${MAX_SIZE / 1024 / 1024} MB.`);
        }

        return blob.text();
    } catch (error) {
        console.error("Error fetching HTML text:", error);
        throw error;
    }
};

export interface FetchOptions {
    bypass?: boolean;
    strategy?: Strategy;
}

export interface FetchResponse {
    html?: string;
    markdown?: string;  // Direct markdown from Jina
    strategy: Strategy;
    success: boolean;
    error?: string;
    elapsed?: number;
}

/**
 * Helper to decode response, handling GBK/GB2312 if detected
 */
export async function decodeResponse(response: Response): Promise<string> {
    const buffer = await response.arrayBuffer();

    // Check for charset in content-type
    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("gb")) {
        return new TextDecoder("gbk").decode(buffer);
    }

    // Try UTF-8 with fatal=true to detect encoding errors
    try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const text = decoder.decode(buffer);

        // Double check for meta charset even if UTF-8 valid (e.g. ASCII only header)
        const head = text.slice(0, 1000).toLowerCase();
        if (head.includes("charset=gb") || head.includes('charset="gb') || head.includes("charset='gb")) {
            return new TextDecoder("gbk").decode(buffer);
        }

        return text;
    } catch (_e) {
        // If UTF-8 fails, try GBK
        // console.warn("UTF-8 decoding failed, trying GBK");
        return new TextDecoder("gbk").decode(buffer);
    }
}

/**
 * Enhanced fetch with multi-strategy support
 */
export const fetchHtmlWithStrategies = async (
    url: string,
    options: FetchOptions = {}
): Promise<FetchResponse> => {
    // @ts-ignore
    const { bypass = false, strategy } = options;

    // TODO: If we want to support custom strategy list injection, we need to update mod.ts
    // For now, we rely on mod.ts's internal logic.

    const result: MultiStrategyResult = await fetchWithStrategies(
        url,
        { bypass, strategy }
    );

    return {
        html: result.html,
        markdown: result.markdown,
        strategy: result.strategy,
        success: result.success,
        error: result.error,
        elapsed: result.elapsed,
    };
};

/**
 * Add CORS headers to response
 */
const addCorsHeaders = (headers: Headers, domain = "*"): Headers => {
    headers.set("Access-Control-Allow-Origin", domain);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    return headers;
};

/**
 * Add download headers
 */
const downloadHeaders = (
    headers: Headers,
    filename: string,
    contentLength: number,
): void => {
    headers.set("content-type", "text/plain; charset=utf-8");
    headers.set("content-Disposition", `attachment; filename=${filename}`);
    headers.set("content-length", contentLength.toString(10));
};

export {
    addCorsHeaders,
    downloadHeaders,
    fetchHtmlText,
    generateFilename,
};
