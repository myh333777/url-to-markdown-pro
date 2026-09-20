// Keep bad input/content quality distinct from unavailable upstream providers.
export function validateArticleUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Invalid article URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Invalid article URL protocol');
}
export function classifyConversionError(error: unknown): { status: number; code: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/^Invalid article URL/.test(message)) return { status: 400, code: 'INVALID_URL' };
  if ((error instanceof Error && error.name === 'ContentQualityError') || /Extracted content failed quality check/.test(message)) {
    return { status: 422, code: 'CONTENT_QUALITY_FAILED' };
  }
  if (/fetch|upstream|strategies failed|timeout|timed out|HTTP\s+\d{3}|API error|aborted/i.test(message)) {
    return { status: 502, code: 'UPSTREAM_FETCH_FAILED' };
  }
  return { status: 500, code: 'CONVERSION_FAILED' };
}
