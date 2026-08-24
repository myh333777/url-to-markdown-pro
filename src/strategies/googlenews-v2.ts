import { fetchWithStrategies } from "./mod.ts";
import { decodeGoogleNewsUrl } from "./google-news-decoder.ts";

interface StrategyResult {
    success: boolean;
    html?: string;
    markdown?: string;
    title?: string;
    strategy: string;
    error?: string;
}
export async function fetchWithGoogleNews(url: string): Promise<StrategyResult> {
    const startedAt = Date.now();
    try {
        const decodedUrl = await decodeGoogleNewsUrl(url);
        if (!decodedUrl || decodedUrl === url) {
            return {
                success: false,
                error: "Google News dynamic decode failed",
                strategy: "googlenews",
            };
        }

        const decoded = new URL(decodedUrl);
        if (decoded.pathname === "/" && !decoded.search) {
            return {
                success: false,
                error: `Google News resolved to a publisher homepage instead of an article: ${decodedUrl}`,
                strategy: "googlenews",
            };
        }

        console.log(`[Google News] Decoded in ${Date.now() - startedAt}ms -> ${decodedUrl}`);
        const result = await fetchWithStrategies(decodedUrl, {
            bypass: true,
            strategy: undefined,
        });

        if (!result.success) {
            return {
                success: false,
                error: `Decoded Google News URL but target fetch failed (${decodedUrl}): ${result.error || "unknown fetch error"}`,
                strategy: "googlenews",
            };
        }

        const response: StrategyResult = {
            success: true,
            title: result.title,
            strategy: `googlenews-${result.strategy}`,
        };
        if (result.markdown) response.markdown = result.markdown;
        if (result.html) response.html = result.html;
        return response;
    } catch (error) {
        return {
            success: false,
            error: `Google News resolution failed: ${error instanceof Error ? error.message : String(error)}`,
            strategy: "googlenews",
        };
    }
}
