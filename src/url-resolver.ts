const SHORT_LINK_HOSTS = new Set([
  "bit.ly",
  "buff.ly",
  "dlvr.it",
  "flip.it",
  "goo.gl",
  "ift.tt",
  "lnkd.in",
  "ow.ly",
  "politi.co",
  "reut.rs",
  "t.co",
  "tinyurl.com",
  "trib.al",
]);

const MAX_REDIRECTS = 6;
const RESOLVE_TIMEOUT_MS = 5_000;

function normalizedHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isKnownShortLink(value: string): boolean {
  return SHORT_LINK_HOSTS.has(normalizedHostname(value));
}

/**
 * Resolve known social/news shorteners before running the expensive content
 * strategies. A short-link wrapper should never determine whether extraction
 * succeeds or whether article images are discoverable.
 */
export async function resolveKnownShortLink(value: string): Promise<string> {
  if (!isKnownShortLink(value)) return value;

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; URL2MD/2.6)",
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        },
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        return target.toString();
      }

      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location || redirectCount === MAX_REDIRECTS) return target.toString();

      const next = new URL(location, target);
      if (!["http:", "https:"].includes(next.protocol)) return target.toString();
      target = next;
    }
  } catch {
    return value;
  } finally {
    clearTimeout(timeout);
  }

  return target.toString();
}
