import { classifyConversionError, validateArticleUrl } from './conversion-error.ts';
function assert(value: unknown): asserts value { if (!value) throw new Error('assertion failed'); }
Deno.test('bad URLs fail before any network access', () => {
  for (const url of ['not a url', 'file:///tmp/article', 'ftp://example.org/a']) {
    let failure;
    try { validateArticleUrl(url); } catch (error) { failure = classifyConversionError(error); }
    assert(failure?.status === 400 && failure.code === 'INVALID_URL');
  }
  validateArticleUrl('https://example.org/a');
});
Deno.test('quality rejection is not an upstream authentication failure', () => {
  const error = new Error('Extracted content failed quality check (score 0)'); error.name = 'ContentQualityError';
  assert(classifyConversionError(error).status === 422);
  assert(classifyConversionError(new Error('All strategies failed. HTTP 403')).status === 502);
  assert(classifyConversionError(new Error('Unexpected parser failure')).status === 500);
});
