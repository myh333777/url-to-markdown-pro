import type { FetchResult } from "./googlebot.ts";

const WREQ_TIMEOUT_MS = 5000;
const WREQ_MAX_CONCURRENCY = 6;

let activeRequests = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(signal?: AbortSignal): Promise<void> {
    if (activeRequests < WREQ_MAX_CONCURRENCY) {
        activeRequests += 1;
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const wake = () => {
            signal?.removeEventListener("abort", onAbort);
            activeRequests += 1;
            resolve();
        };
        const onAbort = () => {
            const index = waiters.indexOf(wake);
            if (index >= 0) waiters.splice(index, 1);
            reject(new DOMException("The operation was aborted", "AbortError"));
        };

        waiters.push(wake);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function releaseSlot(): void {
    activeRequests = Math.max(0, activeRequests - 1);
    waiters.shift()?.();
}

/**
 * Fetch using a real-browser TLS + HTTP/2 fingerprint without launching a
 * browser. wreq-js is loaded lazily so normal URL2MD requests do not pay the
 * native-addon startup or memory cost.
 */
export async function fetchWithWreq(
    url: string,
    signal?: AbortSignal,
): Promise<FetchResult> {
    let acquired = false;
    try {
        await acquireSlot(signal);
        acquired = true;
        const { fetch: wreqFetch } = await import("npm:wreq-js@3.2.0");
        const response = await wreqFetch(url, {
            browser: "chrome_149",
            os: "windows",
            redirect: "follow",
            signal,
            timeout: WREQ_TIMEOUT_MS,
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "wreq",
            };
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "wreq",
            };
        }

        return {
            success: true,
            html: await response.text(),
            strategy: "wreq",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "wreq",
        };
    } finally {
        if (acquired) releaseSlot();
    }
}
