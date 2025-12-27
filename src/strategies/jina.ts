/**
 * Jina Reader API Strategy
 * Uses Jina's free Reader API as ultimate fallback
 * Returns Markdown directly, not HTML
 */

export interface JinaResult {
    success: boolean;
    markdown?: string;
    title?: string;
    error?: string;
    strategy: string;
}

const JINA_READER_URL = "https://r.jina.ai/";

export async function fetchWithJina(url: string): Promise<JinaResult> {
    const jinaUrl = `${JINA_READER_URL}${url}`;

    try {
        const response = await fetch(jinaUrl, {
            headers: {
                "Accept": "text/plain",
                "User-Agent": "URL-to-Markdown/1.0",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Jina API error: ${response.status} ${response.statusText}`,
                strategy: "jina",
            };
        }

        const markdown = await response.text();

        if (!markdown || markdown.length < 50) {
            return {
                success: false,
                error: "Jina returned empty or too short content",
                strategy: "jina",
            };
        }

        // Extract title from first heading if present
        const titleMatch = markdown.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : undefined;

        return {
            success: true,
            markdown,
            title,
            strategy: "jina",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "jina",
        };
    }
}

/**
 * Jina Search API for web search
 */
export async function searchWithJina(query: string): Promise<JinaResult> {
    const searchUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;

    try {
        const response = await fetch(searchUrl, {
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Jina Search error: ${response.status}`,
                strategy: "jina-search",
            };
        }

        const markdown = await response.text();
        return {
            success: true,
            markdown,
            strategy: "jina-search",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "jina-search",
        };
    }
}
