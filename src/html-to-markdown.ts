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
 */
function createTurndownService(preserveImages = true): TurndownService {
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

                // Build markdown image syntax
                if (title && title !== alt) {
                    return `![${alt}](${src} "${title}")`;
                }
                return `![${alt}](${src})`;
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

                const src = img.getAttribute("src") || "";
                const alt = figcaption?.textContent || img.getAttribute("alt") || "image";

                return `\n\n![${alt}](${src})\n\n`;
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
 */
const htmlTextToMarkdown = (html: string, preserveImages = true): string => {
    // Polyfill DOMParser for Turndown in Deno environment
    if (!globalThis.DOMParser) {
        // @ts-ignore - assigning to global
        globalThis.DOMParser = DOMParser;
    }

    // Convert to Markdown
    const turndownService = createTurndownService(preserveImages);

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
 */
const generateMarkdownText = (
    htmlText: string,
    preserveImages = true
): string => {
    const document = parseHtml(htmlText);
    const { content, title, author } = extractArticleContent(document);
    const markdownText = htmlTextToMarkdown(content, preserveImages);

    let result = `# ${title}\n\n`;
    if (author) {
        result += `*By ${author}*\n\n`;
    }
    result += markdownText;

    return result;
};

/**
 * Generate JSON response from HTML text
 */
const generateJsonData = (
    htmlText: string,
    url: string,
    strategy = "direct",
    preserveImages = true
): string => {
    const document = parseHtml(htmlText);
    const { content, title, author } = extractArticleContent(document);
    const markdownText = htmlTextToMarkdown(content, preserveImages);

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
