/**
 * JSON-LD Extraction Module
 * Prioritizes structured data extraction before Readability
 */

import { DOMParser, type HTMLDocument } from "deno-dom";

export interface JsonLdResult {
    title: string;
    content: string;
    author?: string;
    date?: string;
}

/**
 * Extract article content from JSON-LD structured data
 */
export function extractFromJsonLd(html: string): JsonLdResult | null {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        if (!doc) return null;

        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

        for (const script of scripts) {
            try {
                const jsonText = script.textContent;
                if (!jsonText) continue;

                const data = JSON.parse(jsonText);
                const items = Array.isArray(data) ? data : [data];

                for (const item of items) {
                    if (!item || typeof item !== "object") continue;

                    // Check @type
                    let itemType = item["@type"] || "";
                    if (Array.isArray(itemType)) {
                        itemType = itemType[0] || "";
                    }

                    const validTypes = ["Article", "NewsArticle", "BlogPosting", "WebPage", "ReportageNewsArticle"];
                    if (!validTypes.includes(itemType)) continue;

                    // Extract articleBody
                    let body = item.articleBody || item.text || "";
                    if (Array.isArray(body)) {
                        body = body.filter(Boolean).join(" ");
                    }
                    body = String(body).trim();

                    if (body.length < 200) continue;

                    // Extract title
                    let title = item.headline || item.name || "";
                    if (Array.isArray(title)) {
                        title = title[0] || "";
                    }
                    title = String(title).trim();

                    // Extract author
                    let author = "";
                    const authorData = item.author;
                    if (typeof authorData === "object" && authorData !== null) {
                        author = authorData.name || "";
                    } else if (Array.isArray(authorData) && authorData[0]) {
                        const first = authorData[0];
                        author = typeof first === "object" ? first.name || "" : String(first);
                    } else if (authorData) {
                        author = String(authorData);
                    }

                    // Extract date
                    const date = item.datePublished || item.dateModified || "";

                    console.log(`[JSON-LD] Extracted: ${title.slice(0, 50)}`);
                    return { title, content: body, author, date };
                }
            } catch {
                // JSON parse error, try next script
                continue;
            }
        }
    } catch (error) {
        console.warn("[JSON-LD] Extraction failed:", error);
    }

    return null;
}
