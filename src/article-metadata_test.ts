import {
  extractArticleMetadataFromHtml,
  extractArticleMetadataFromMarkdown,
} from "./article-metadata.ts";

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("extracts publisher metadata and stable hero image", () => {
  const html = `
    <html><head>
      <meta content="Story title" property="og:title">
      <meta content="/hero.jpg?x=1&amp;y=2" property="og:image">
      <meta content="Reporter" name="author">
      <script type="application/ld+json">
        {"@type":"NewsArticle","headline":"JSON title","image":{"url":"/json-hero.jpg"}}
      </script>
    </head><body>
      <article>
        <img src="/lazyload-fallback.gif" data-lazy-src="/photo.jpg" alt="Photo">
      </article>
    </body></html>`;

  const metadata = extractArticleMetadataFromHtml(html, "https://example.com/news/story");
  assertEquals(metadata.title, "Story title", "title");
  assertEquals(metadata.author, "Reporter", "author");
  assertEquals(metadata.images.hero, "https://example.com/hero.jpg?x=1&y=2", "hero");
  assertEquals(metadata.images.contentImages[0], "https://example.com/photo.jpg", "content image");
});

Deno.test("extracts markdown image candidates", () => {
  const markdown = `# Story\n\n*By Reporter*\n\n![Main](https://cdn.example.com/main.jpg)\n\nBody.`;
  const metadata = extractArticleMetadataFromMarkdown(markdown, "https://example.com/story");
  assertEquals(metadata.title, "Story", "markdown title");
  assertEquals(metadata.author, "Reporter", "markdown author");
  assertEquals(metadata.images.hero, "https://cdn.example.com/main.jpg", "markdown hero");
});
