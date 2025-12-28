import { DOMParser, type HTMLDocument, Node, Element, Document } from "deno-dom";
// ... imports ...

// Polyfill DOMParser and other globals for Turndown in Deno environment
// Force assignment to ensure we use deno-dom implementation (native in Deploy might be broken)
// @ts-ignore - assigning to global
globalThis.DOMParser = DOMParser;
// @ts-ignore
globalThis.Node = Node;
// @ts-ignore
globalThis.Element = Element;
// @ts-ignore
globalThis.Document = Document;
import { Readability } from "readability";
import TurndownService from "turndown";
import turndownPluginGfm from "turndownPluginGfm";

/**
 * Resolve a URL (relative or absolute) against a base URL
 */
function resolveUrl(src: string, baseUrl?: string): string {
    if (!src || !baseUrl) return src;

    // Already absolute URL
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) {
        // Handle protocol-relative URLs
        if (src.startsWith("//")) {
            try {
                const base = new URL(baseUrl);
                return `${base.protocol}${src}`;
            } catch {
                return `https:${src}`;
            }
        }
        return src;
    }

    // Data URLs or other schemes - return as-is
    if (src.includes(":")) return src;

    try {
        const base = new URL(baseUrl);

        // Absolute path (starts with /)
        if (src.startsWith("/")) {
            return `${base.origin}${src}`;
        }

        // Relative path - resolve against base URL
        const baseDir = base.pathname.substring(0, base.pathname.lastIndexOf("/") + 1);
        return `${base.origin}${baseDir}${src}`;
    } catch {
        // If URL parsing fails, return original
        return src;
    }
}

interface JSONResponse {
    url: string;
    title: string;
    date: string;
    content: string;
    strategy?: string;
    author?: string;
}

interface ArticleContent {
    title: string;
    content: string;
    author?: string;
    siteName?: string;
    excerpt?: string;
}

type MainArticleContent = NonNullable<ReturnType<Readability["parse"]>>;

// Turndown options - enhanced for better Markdown output
const turndownOptions: TurndownService.Options = {
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    preformattedCode: true,
    linkStyle: "referenced",
    hr: "---",
    emDelimiter: "*",
    strongDelimiter: "**",
};

/**
 * Create Turndown service with image preservation
 * @param preserveImages - Whether to preserve images in output
 * @param baseUrl - Base URL for resolving relative image paths
 */
function createTurndownService(preserveImages = true, baseUrl?: string): TurndownService {
    const service = new TurndownService(turndownOptions);
    // service.use(turndownPluginGfm.gfm); // Disabled due to isCodeBlock_ error

    if (preserveImages) {
        // Enhanced image handling with data-src support for lazy-loaded images
        service.addRule("images", {
            filter: "img",
            replacement: (_content: string, node: Node) => {
                const element = node as unknown as HTMLImageElement;
                // Priority: data-src > data-lazy-src > src (for lazy-loaded images)
                const src = element.getAttribute("data-src")
                    || element.getAttribute("data-lazy-src")
                    || element.getAttribute("src")
                    || "";
                const alt = element.getAttribute("alt") || element.getAttribute("title") || "image";
                const title = element.getAttribute("title");

                // Skip base64 placeholder images
                if (!src || src.startsWith("data:")) return "";

                // Resolve relative URLs to absolute
                const absoluteSrc = resolveUrl(src, baseUrl);

                // Build markdown image syntax
                if (title && title !== alt) {
                    return `![${alt}](${absoluteSrc} "${title}")`;
                }
                return `![${alt}](${absoluteSrc})`;
            },
        });

        // Handle figure elements with captions
        service.addRule("figure", {
            filter: "figure",
            replacement: (content: string, node: Node) => {
                const element = node as unknown as HTMLElement;
                const img = element.querySelector("img");
                const figcaption = element.querySelector("figcaption");

                if (!img) return content;

                // Priority: data-src > data-lazy-src > src (for lazy-loaded images in figures)
                const src = img.getAttribute("data-src")
                    || img.getAttribute("data-lazy-src")
                    || img.getAttribute("src")
                    || "";

                if (!src || src.startsWith("data:")) return content;

                const alt = figcaption?.textContent || img.getAttribute("alt") || "image";
                const absoluteSrc = resolveUrl(src, baseUrl);

                return `\n\n![${alt}](${absoluteSrc})\n\n`;
            },
        });
    } else {
        // Original behavior - remove images
        service.remove(["figure", "img", "iframe"]);
    }

    // Enhanced code block handling


    return service;
}

/**
 * Parse HTML string to Document
 */
const parseHtml = (htmlText: string): HTMLDocument => {
    const document = new DOMParser().parseFromString(htmlText, "text/html");
    if (!document) {
        throw new Error("Could not parse HTML");
    }
    return document;
};

/**
 * Extract article content using Readability
 * Falls back to body content if article extraction fails
 */
const extractArticleContent = (
    document: HTMLDocument,
): ArticleContent => {
    try {
        const mainArticle = new Readability(document).parse();

        if (mainArticle) {
            return {
                title: mainArticle.title,
                content: mainArticle.content,
                author: mainArticle.byline || undefined,
                siteName: mainArticle.siteName || undefined,
                excerpt: mainArticle.excerpt || undefined,
            };
        }
    } catch (error) {
        console.warn("Readability extraction failed:", error);
    }

    // Fallback: try to extract from body
    const body = document.body;
    const title = document.title || document.querySelector("h1")?.textContent || "Untitled";

    if (!body) {
        throw new Error("Could not find main article or body content");
    }

    return {
        title,
        content: body.innerHTML,
    };
};

/**
 * Convert HTML to Markdown
 * @param html - HTML content to convert
 * @param preserveImages - Whether to preserve images
 * @param baseUrl - Base URL for resolving relative image paths
 */
const htmlTextToMarkdown = (html: string, preserveImages = true, baseUrl?: string): string => {
    // Polyfill DOMParser for Turndown in Deno environment
    if (!globalThis.DOMParser) {
        // @ts-ignore - assigning to global
        globalThis.DOMParser = DOMParser;
    }

    // Convert to Markdown with base URL for resolving relative paths
    const turndownService = createTurndownService(preserveImages, baseUrl);

    // Explicitly parse to DOM and pass the node to Turndown
    // This combined with global polyfills should work in Deno Deploy
    const contentDoc = new DOMParser().parseFromString(html, "text/html");
    if (contentDoc) {
        return turndownService.turndown(contentDoc);
    }

    return turndownService.turndown(html);
};

/**
 * Generate Markdown from HTML text
 * @param htmlText - Full HTML page content
 * @param preserveImages - Whether to preserve images
 * @param baseUrl - Base URL for resolving relative image paths
 */
const generateMarkdownText = (
    htmlText: string,
    preserveImages = true,
    baseUrl?: string
): string => {
    const document = parseHtml(htmlText);
    const { content, title, author } = extractArticleContent(document);
    const markdownText = htmlTextToMarkdown(content, preserveImages, baseUrl);

    let result = `# ${title}\n\n`;
    if (author) {
        result += `*By ${author}*\n\n`;
    }
    result += markdownText;

    return result;
};

/**
 * Generate JSON response from HTML text
 * @param htmlText - Full HTML page content
 * @param url - Original URL (used for both output and resolving relative paths)
 * @param strategy - Fetch strategy used
 * @param preserveImages - Whether to preserve images
 */
const generateJsonData = (
    htmlText: string,
    url: string,
    strategy = "direct",
    preserveImages = true
): string => {
    const document = parseHtml(htmlText);
    const { content, title, author } = extractArticleContent(document);
    // Use url as baseUrl to resolve relative image paths
    const markdownText = htmlTextToMarkdown(content, preserveImages, url);

    let markdownContent = `# ${title}\n\n`;
    if (author) {
        markdownContent += `*By ${author}*\n\n`;
    }
    markdownContent += markdownText;

    const jsonResponse: JSONResponse = {
        url,
        title,
        date: new Date().toISOString(),
        content: markdownContent,
        strategy,
        author,
    };

    return JSON.stringify(jsonResponse, null, 2);
};

export {
    generateJsonData,
    generateMarkdownText,
    htmlTextToMarkdown,
    parseHtml,
    extractArticleContent,
};
