# Full-text provider resilience

This release changes only provider handling, not publisher access rights or extraction quality thresholds.

Jina Reader supports the optional server environment variable `JINA_API_KEY`. No key is embedded in code or returned by `/health`. When absent, the original anonymous request remains available; if the provider returns 401, configure a valid key in the existing deployment's environment. A valid paid key may incur the provider's normal charges; this project does not purchase tokens, create keys, or enable automatic billing.

401/402/403 put Jina into a short isolate-local cooldown. Archive 429 respects `Retry-After` (bounded to 30 seconds–1 hour, default 5 minutes). Repeated articles do not immediately retry a cooled provider. Archive uses bounded cancellation through metadata and snapshot response bodies. Concurrent late successes cannot erase a live cooldown. Jina transport failures get a one-minute cooldown; caller cancellation does not. These circuits are per running isolate, not a global rate-limit guarantee.

`/health` remains an HTTP-200 liveness check and now reports `healthScope: service-liveness`, `revision: provider-resilience-v1`, and sanitized `providerHealth`. `not_tested` is not a success claim. Failed `/api` upstream fetches return 502 with `UPSTREAM_FETCH_FAILED` and provider states; malformed input is 400, content-quality rejection 422, and other conversion errors 500; successful direct extraction is not disabled because an optional fallback is unavailable.

Run isolated tests without real credentials or external network requests:

```sh
env -u JINA_API_KEY deno test --allow-env=JINA_API_KEY src/strategies/provider-health_test.ts
```

The source checkout had unrelated local changes during maintenance. CI checks committed whitespace and native extraction tests without fetching real publishers. Local tasks also retain access to the previously supported optional `EXA_API_KEY`. This release is prepared in an isolated worktree from the verified remote main; those changes are not overwritten or included.
