/**
 * Archive.org Strategy
 * Fetches historical snapshots from Web Archive
 */

import type { FetchResult } from "./googlebot.ts";

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

export async function fetchFromArchive(url: string): Promise<FetchResult> {
    try {
        // First, check if URL is available in archive
        const checkUrl = `${ARCHIVE_API}?url=${encodeURIComponent(url)}`;
        const checkResponse = await fetch(checkUrl);

        if (!checkResponse.ok) {
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
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                },
            });

            if (!directResponse.ok) {
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
        const response = await fetch(snapshot.url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml",
            },
        });

        if (!response.ok) {
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
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "archive",
        };
    }
}
