// Provider-level failures must not be retried for every article. This is an
// isolate-local circuit breaker, not a distributed quota or a per-site bypass.
export type Provider = 'jina' | 'archive';
type Observation = { status: number; until: number; at: number };
const observations = new Map<Provider, Observation>();
export function configuredJinaKey(): string {
  try { return Deno.env.get('JINA_API_KEY')?.trim() || ''; } catch { return ''; }
}
export function retryDelay(value: string | null, now = Date.now()): number {
  const seconds = value && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const date = value ? Date.parse(value) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now : 300000;
  return Math.max(30000, Math.min(3600000, requested));
}
export function noteProviderResponse(provider: Provider, response: Response): void {
  const now = Date.now();
  const cooldown = response.status === 429 ? retryDelay(response.headers.get('retry-after'), now)
    : [401, 402, 403].includes(response.status) ? 300000 : 0;
  observations.set(provider, { status: response.status, at: now, until: now + cooldown });
}
export function providerCooldown(provider: Provider): string | null {
  const entry = observations.get(provider);
  if (!entry || entry.until <= Date.now()) return null;
  const seconds = Math.ceil((entry.until - Date.now()) / 1000);
  return `${provider} provider ${entry.status}; cooldown ${seconds}s (no upstream retry)`;
}
export function providerHealth(): Record<Provider, { state: string; lastStatus: number | null; retryAfterSeconds: number; authenticated?: boolean }> {
  const result = {} as ReturnType<typeof providerHealth>;
  for (const provider of ['jina', 'archive'] as const) {
    const row = observations.get(provider);
    const retryAfterSeconds = Math.max(0, Math.ceil(((row?.until || 0) - Date.now()) / 1000));
    result[provider] = {
      state: !row ? 'not_tested' : retryAfterSeconds ? (row.status === 429 ? 'rate_limited' : 'auth_required')
        : row.status >= 200 && row.status < 300 ? 'last_request_ok' : 'retry_available',
      lastStatus: row?.status ?? null, retryAfterSeconds,
      ...(provider === 'jina' ? { authenticated: Boolean(configuredJinaKey()) } : {}),
    };
  }
  return result;
}
export function resetProviderObservations(): void { observations.clear(); }
