import { fetchWithJina } from './jina.ts';
import { fetchFromArchive } from './archive.ts';
import { providerHealth, resetProviderObservations, retryDelay, noteProviderResponse } from './provider-health.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
Deno.test('Jina 401 is classified and does not retry on the next article', async () => {
  const original = globalThis.fetch; let calls = 0; resetProviderObservations();
  globalThis.fetch = () => { calls++; return Promise.resolve(new Response('Unauthorized', { status: 401 })); };
  try {
    const first = await fetchWithJina('https://example.org/a');
    const second = await fetchWithJina('https://example.org/b');
    assert(!first.success && first.error?.includes('authentication required'));
    assert(!second.success && second.error?.includes('cooldown')); assert(calls === 1);
    assert(providerHealth().jina.state === 'auth_required');
    assert(!JSON.stringify(providerHealth()).includes('Bearer'));
  } finally { globalThis.fetch = original; resetProviderObservations(); }
});
Deno.test('Jina sends a configured key only to the fixed reader endpoint', async () => {
  const original = globalThis.fetch; resetProviderObservations();
  Deno.env.set('JINA_API_KEY', 'fixture-key-not-valid');
  globalThis.fetch = (input, init) => {
    assert(String(input).startsWith('https://r.jina.ai/'));
    const options = init as { headers?: HeadersInit; redirect?: string } | undefined;
    assert(new Headers(options?.headers).get('Authorization') === 'Bearer fixture-key-not-valid');
    assert(options?.redirect === 'error');
    return Promise.resolve(new Response('# Article\n\n' + 'Complete fixture text. '.repeat(10)));
  };
  try { assert((await fetchWithJina('https://example.org/a')).success); }
  finally { globalThis.fetch = original; Deno.env.delete('JINA_API_KEY'); resetProviderObservations(); }
});
Deno.test('Archive respects 429 Retry-After and does not request a second snapshot', async () => {
  const original = globalThis.fetch; let calls = 0; resetProviderObservations();
  globalThis.fetch = () => { calls++; return Promise.resolve(new Response('Limited', { status: 429, headers: { 'Retry-After': '120' } })); };
  try {
    assert(!(await fetchFromArchive('https://example.org/a')).success);
    const next = await fetchFromArchive('https://example.org/b');
    assert(!next.success && next.error?.includes('cooldown')); assert(calls === 1);
    assert(providerHealth().archive.retryAfterSeconds <= 120 && providerHealth().archive.retryAfterSeconds > 110);
  } finally { globalThis.fetch = original; resetProviderObservations(); }
});
Deno.test('Archive abort propagates instead of returning a successful fallback', async () => {
  const controller = new AbortController(); controller.abort();
  let cancelled = false;
  try { await fetchFromArchive('https://example.org/a', controller.signal); }
  catch (error) { cancelled = error instanceof DOMException && error.name === 'AbortError'; }
  assert(cancelled);
});
Deno.test('concurrent success and shorter limits do not erase an active cooldown', () => {
  resetProviderObservations();
  noteProviderResponse('archive', new Response(null, { status: 429, headers: { 'Retry-After': '1800' } }));
  noteProviderResponse('archive', new Response(null, { status: 200 }));
  noteProviderResponse('archive', new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
  assert(providerHealth().archive.retryAfterSeconds > 1700);
  assert(providerHealth().archive.state === 'rate_limited');
  resetProviderObservations();
});
Deno.test('transport failures cool down without following redirects or repeated requests', async () => {
  const original = globalThis.fetch; let calls = 0; resetProviderObservations();
  globalThis.fetch = () => { calls++; return Promise.reject(new TypeError('network or redirect failure')); };
  try {
    assert(!(await fetchWithJina('https://example.org/a')).success);
    assert((await fetchWithJina('https://example.org/b')).error?.includes('cooldown'));
    assert(calls === 1 && providerHealth().jina.state === 'temporarily_unavailable');
  } finally { globalThis.fetch = original; resetProviderObservations(); }
});
Deno.test('Retry-After accepts dates and clamps corrupt or extreme values', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  assert(retryDelay('Sun, 20 Sep 2026 00:02:00 GMT', now) === 120000);
  assert(retryDelay('bad', now) === 300000);
  assert(retryDelay('1.5', now) === 300000);
  assert(retryDelay('2026-09-21', now) === 300000);
  assert(retryDelay('9999999', now) === 3600000);
});
