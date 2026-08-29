import { DOMParser, type Element } from "deno-dom";

const MAX_CONTENT_IMAGES = 12;
const TRACKING_HOSTS = new Set([
  "analytics.twitter.com",
  "sb.scorecardresearch.com",
  "t.co",
]);

const PLACEHOLDER_PATTERNS = [
  /(?:^|[-_/])(blank|dummy|loading|placeholder|skeleton|spacer)(?:[-_.?/]|$)/i,
  /(?:^|[-_/])1x1(?:[-_.?/]|$)/i,
  /pixel\.gif/i,
  /lazyload-fallback/i,
];

export interface ArticleImages {
  hero: string;
  ogImage: string;
  twitterImage: string;
  jsonLdImage: string;
  contentImages: string[];
  candidates: string[];
}

export interface ArticleMetadata {
  title: string;
  author: string;
  publishedAt: string;
  images: ArticleImages;
}

function emptyImages(): ArticleImages {
  return {
    hero: "",
    ogImage: "",
    twitterImage: "",
    jsonLdImage: "",
    contentImages: [],
    candidates: [],
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeImageUrl(value: unknown, baseUrl: string): string {
  if (typeof value !== "string") return "";
  const decoded = decodeHtmlEntities(value.trim());
  if (!decoded || decoded.startsWith("data:") || decoded.startsWith("blob:")) return "";
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(decoded))) return "";

  try {
    const resolved = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return "";
    if (TRACKING_HOSTS.has(resolved.hostname.toLowerCase())) return "";
    return resolved.toString();
  } catch {
    return "";
  }
}

function addUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

function srcsetCandidate(srcset: string, baseUrl: string): string {
  const candidates = srcset
    .split(",")
    .map((entry) => {
      const [rawUrl, descriptor = ""] = entry.trim().split(/\s+/, 2);
      const width = descriptor.endsWith("w") ? Number.parseFloat(descriptor) : 0;
      const density = descriptor.endsWith("x") ? Number.parseFloat(descriptor) : 0;
      const score = width > 0
        ? -Math.abs(width - 1200)
        : density > 0
          ? density * 100
          : 0;
      return { url: normalizeImageUrl(rawUrl, baseUrl), score };
    })
    .filter((entry) => entry.url);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function imageFromElement(element: Element, baseUrl: string): string {
  const rawCandidates = [
    element.getAttribute("data-src"),
    element.getAttribute("data-original"),
    element.getAttribute("data-lazy-src"),
    element.getAttribute("data-url"),
    element.getAttribute("src"),
  ];
  for (const candidate of rawCandidates) {
    const normalized = normalizeImageUrl(candidate, baseUrl);
    if (normalized) return normalized;
  }

  const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset") || "";
  return srcsetCandidate(srcset, baseUrl);
}

function readMeta(document: ReturnType<DOMParser["parseFromString"]>, names: string[]): string {
  if (!document) return "";
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const node of document.querySelectorAll("meta")) {
    const element = node as unknown as Element;
    const key = (element.getAttribute("property") || element.getAttribute("name") || "").toLowerCase();
    if (!wanted.has(key)) continue;
    const content = element.getAttribute("content") || "";
    if (content) return content;
  }
  return "";
}

function collectJsonLd(value: unknown, output: {
  title: string;
  author: string;
  publishedAt: string;
  images: string[];
}, baseUrl: string): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, output, baseUrl);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"])
    ? record["@type"].join(" ")
    : String(record["@type"] || "");
  const isArticle = /(article|newsarticle|blogposting|reportagenewsarticle)/i.test(type);

  if (isArticle) {
    if (!output.title && typeof record.headline === "string") output.title = record.headline;
    if (!output.publishedAt && typeof record.datePublished === "string") output.publishedAt = record.datePublished;

    const author = record.author;
    if (!output.author) {
      if (typeof author === "string") output.author = author;
      else if (Array.isArray(author)) {
        const names = author.flatMap((item) => {
          if (typeof item === "string") return [item];
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string") {
            return [String((item as Record<string, unknown>).name)];
          }
          return [];
        });
        output.author = names.join(", ");
      } else if (author && typeof author === "object" && typeof (author as Record<string, unknown>).name === "string") {
        output.author = String((author as Record<string, unknown>).name);
      }
    }

    const images = Array.isArray(record.image) ? record.image : [record.image];
    for (const image of images) {
      const raw = typeof image === "string"
        ? image
        : image && typeof image === "object"
          ? String((image as Record<string, unknown>).url || (image as Record<string, unknown>).contentUrl || "")
          : "";
      const normalized = normalizeImageUrl(raw, baseUrl);
      if (normalized) addUnique(output.images, normalized);
    }
  }

  for (const child of Object.values(record)) collectJsonLd(child, output, baseUrl);
}

export function extractArticleMetadataFromHtml(html: string, baseUrl: string): ArticleMetadata {
  const images = emptyImages();
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document) return { title: "", author: "", publishedAt: "", images };

  const title = readMeta(document, ["og:title", "twitter:title"])
    || document.querySelector("title")?.textContent?.trim()
    || "";
  const author = readMeta(document, ["author", "article:author", "byl"]);
  const publishedAt = readMeta(document, [
    "article:published_time",
    "date",
    "datepublished",
    "parsely-pub-date",
  ]);

  images.ogImage = normalizeImageUrl(readMeta(document, ["og:image:secure_url", "og:image"]), baseUrl);
  images.twitterImage = normalizeImageUrl(readMeta(document, ["twitter:image", "twitter:image:src"]), baseUrl);

  const imageSrcLink = [...document.querySelectorAll("link")]
    .map((node) => node as unknown as Element)
    .find((element) => (element.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("image_src"));
  const linkImage = normalizeImageUrl(imageSrcLink?.getAttribute("href") || "", baseUrl);

  const jsonLd = { title: "", author: "", publishedAt: "", images: [] as string[] };
  for (const scriptNode of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectJsonLd(JSON.parse(scriptNode.textContent || ""), jsonLd, baseUrl);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  images.jsonLdImage = jsonLd.images[0] || "";

  const contentRoot = document.querySelector("article") || document.querySelector("main") || document.body;
  if (contentRoot) {
    for (const imgNode of contentRoot.querySelectorAll("img")) {
      const img = imgNode as unknown as Element;
      const candidate = imageFromElement(img, baseUrl);
      if (candidate) addUnique(images.contentImages, candidate);
      if (images.contentImages.length >= MAX_CONTENT_IMAGES) break;
    }
  }

  for (const candidate of [
    images.ogImage,
    images.twitterImage,
    images.jsonLdImage,
    linkImage,
    ...images.contentImages,
  ]) addUnique(images.candidates, candidate);
  images.hero = images.candidates[0] || "";

  return {
    title: title || jsonLd.title,
    author: author || jsonLd.author,
    publishedAt: publishedAt || jsonLd.publishedAt,
    images,
  };
}

export function extractArticleMetadataFromMarkdown(markdown: string, baseUrl: string): ArticleMetadata {
  const images = emptyImages();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  const author = markdown.match(/^\*By\s+(.+?)\*$/mi)?.[1]?.trim() || "";

  const imagePattern = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of markdown.matchAll(imagePattern)) {
    const candidate = normalizeImageUrl(match[1], baseUrl);
    if (candidate) addUnique(images.contentImages, candidate);
    if (images.contentImages.length >= MAX_CONTENT_IMAGES) break;
  }
  images.candidates = [...images.contentImages];
  images.hero = images.candidates[0] || "";
  return { title, author, publishedAt: "", images };
}

export function mergeArticleImages(primary: ArticleImages, fallback: ArticleImages): ArticleImages {
  const merged = emptyImages();
  merged.ogImage = primary.ogImage || fallback.ogImage;
  merged.twitterImage = primary.twitterImage || fallback.twitterImage;
  merged.jsonLdImage = primary.jsonLdImage || fallback.jsonLdImage;
  for (const image of [...primary.contentImages, ...fallback.contentImages]) addUnique(merged.contentImages, image);
  for (const image of [
    primary.hero,
    fallback.hero,
    merged.ogImage,
    merged.twitterImage,
    merged.jsonLdImage,
    ...merged.contentImages,
  ]) addUnique(merged.candidates, image);
  merged.hero = merged.candidates[0] || "";
  return merged;
}

const METADATA_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];

async function readHeadHtml(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return text;
}

/**
 * Lightweight image-metadata recovery for strategies that return excellent
 * article text but omit images (for example some Exa results). Only the page
 * head is sampled and this function is called only when normal extraction did
 * not discover any usable image.
 */
export async function discoverPublisherMetadata(url: string): Promise<ArticleMetadata> {
  const empty: ArticleMetadata = { title: "", author: "", publishedAt: "", images: emptyImages() };

  for (const userAgent of METADATA_USER_AGENTS) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(1_800),
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await readHeadHtml(response);
      if (!html) continue;
      const metadata = extractArticleMetadataFromHtml(html, response.url || url);
      if (metadata.images.hero || metadata.title || metadata.author) return metadata;
    } catch {
      // Try the next lightweight identity.
    }
  }

  return empty;
}
