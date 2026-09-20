/**
 * Archive.org Strategy
 * Fetches historical snapshots from Web Archive
 */

import type { FetchResult } from "./googlebot.ts";
import { noteProviderResponse, providerCooldown } from './provider-health.ts';

const ARCHIVE_API = "https://archive.org/wayback/available";
const ARCHIVE_WEB = "https://web.archive.org/web";

interface ArchiveResponse {
    archived_snapshots?: {
        closest?: {
            url: string;
            timestamp: string;
            status: string;
        };
    };
}

export async function fetchFromArchive(url: string, signal?: AbortSignal): Promise<FetchResult> {
    signal?.throwIfAborted();
    const cooling = providerCooldown('archive');
    if (cooling) return { success: false, strategy: 'archive', error: cooling };
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Archive timeout', 'TimeoutError')), 15000);
    try {
        // First, check if URL is available in archive
        const checkUrl = `${ARCHIVE_API}?url=${encodeURIComponent(url)}`;
        const checkResponse = await fetch(checkUrl, { signal: controller.signal });
        noteProviderResponse('archive', checkResponse);

        if (!checkResponse.ok) {
            await checkResponse.body?.cancel();
            return {
                success: false,
                error: `Archive API error: ${checkResponse.status}`,
                strategy: "archive",
            };
        }

        const archiveData: ArchiveResponse = await checkResponse.json();
        const snapshot = archiveData.archived_snapshots?.closest;

        if (!snapshot || snapshot.status !== "200") {
            // Fallback: try direct web.archive.org access
            const directUrl = `${ARCHIVE_WEB}/${url}`;
            const directResponse = await fetch(directUrl, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                },
            });

            noteProviderResponse('archive', directResponse);
            if (!directResponse.ok) {
                await directResponse.body?.cancel();
                return {
                    success: false,
                    error: "No archive snapshot available",
                    strategy: "archive",
                };
            }

            const html = await directResponse.text();
            return {
                success: true,
                html,
                strategy: "archive",
            };
        }

        // Fetch the archived snapshot
        const snapshotUrl = new URL(snapshot.url);
        if (snapshotUrl.hostname !== 'web.archive.org' || !['http:', 'https:'].includes(snapshotUrl.protocol)) throw new Error('Invalid archive snapshot URL');
        snapshotUrl.protocol = 'https:';
        const response = await fetch(snapshotUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml",
            },
        });

        noteProviderResponse('archive', response);
        if (!response.ok) {
            await response.body?.cancel();
            return {
                success: false,
                error: `Failed to fetch archive: ${response.status}`,
                strategy: "archive",
            };
        }

        const html = await response.text();
        return {
            success: true,
            html,
            strategy: "archive",
        };
    } catch (error) {
        signal?.throwIfAborted();
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "archive",
        };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
