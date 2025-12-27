
// import { StrategyResult } from "./types.ts";
import { fetchWithStrategies } from "./mod.ts";

interface StrategyResult {
    success: boolean;
    html?: string;
    markdown?: string;
    title?: string;
    strategy: string;
    error?: string;
}

export async function fetchWithGoogleNews(url: string): Promise<StrategyResult> {
    try {
        console.log(`[Google News] Attempting to decode URL: ${url}`);

        // Dynamic import to handle npm compatibility safely
        // @ts-ignore
        const mod = await import("npm:google_news_link_decode");

        let decodeFunc;
        if (mod.default && mod.default.decodeGoogleNewsUrl) {
            decodeFunc = mod.default.decodeGoogleNewsUrl;
        } else if (mod.decodeGoogleNewsUrl) {
            decodeFunc = mod.decodeGoogleNewsUrl;
        } else {
            // Fallback for different export styles
            decodeFunc = mod.default || mod;
        }

        if (typeof decodeFunc !== 'function') {
            throw new Error("Could not find decodeGoogleNewsUrl function in library");
        }

        // Decode the URL
        const decodedUrl = await decodeFunc(url);

        if (!decodedUrl || !decodedUrl.startsWith("http")) {
            throw new Error(`Decoded URL is invalid: ${decodedUrl}`);
        }

        console.log(`[Google News] Successfully decoded to: ${decodedUrl}`);

        // Recursively fetch the real URL using standard strategies
        // We pass 'bypass' options if needed, but here we just want the content
        // We set strategy to 'auto' or ignore to let it race
        const result = await fetchWithStrategies(decodedUrl, {
            bypass: true,
            strategy: undefined // let it race
        });

        // Map MultiStrategyResult to StrategyResult
        if (result.success) {
            return {
                success: true,
                html: result.html,
                markdown: result.markdown,
                title: result.title,
                strategy: "googlenews-" + result.strategy,
                error: result.error
            };
        } else {
            return {
                success: false,
                error: result.error || "Failed to fetch decoded URL",
                strategy: "googlenews"
            };
        }

    } catch (error) {
        // @ts-ignore
        console.error(`[Google News] Error: ${error.message}`);

        // Fallback: If decoding fails, we can try Exa?
        // But Exa is already in the strategies.

        return {
            success: false,
            // @ts-ignore
            error: `Google News Decode Failed: ${error.message}`,
            strategy: "googlenews"
        };
    }
}
