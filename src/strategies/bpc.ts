/**
 * Deno-native HTTP subset of Bypass Paywalls Clean rules.
 *
 * This intentionally excludes browser-only behavior such as script blocking,
 * DOM rewrites, extension APIs and Chromium. Only request-level rules that can
 * be expressed with fetch() are included here.
 */

import { decodeResponse } from "../utils.ts";
import type { FetchResult } from "./googlebot.ts";

type UserAgentMode = "googlebot" | "bingbot" | "facebookbot";

interface BpcHttpProfile {
    userAgentMode?: UserAgentMode;
    userAgent?: string;
    referer?: string;
    headers?: Record<string, string>;
    randomIpRegion?: "eu";
}

const UA_NORMAL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const UA_GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const UA_BINGBOT = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const UA_FACEBOOKBOT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

// Expanded from BPC group rules and HTTP-capable exceptions. Browser-only
// block_regex/cs_code/DOM rules are deliberately not represented here.
const GOOGLEBOT_DOMAINS = new Set([
    "24heures.ch",
    "aftenposten.no",
    "ajc.com",
    "ara.cat",
    "arabalears.cat",
    "argusdelassurance.com",
    "azcentral.com",
    "bazonline.ch",
    "beleggersbelangen.nl",
    "berkshireeagle.com",
    "bernerzeitung.ch",
    "businessinsider.com",
    "cahiers-techniques-batiment.fr",
    "chunichi.co.jp",
    "cincinnati.com",
    "commercialappeal.com",
    "courier-journal.com",
    "dagensmedicin.se",
    "dagsavisen.no",
    "dallasnews.com",
    "democratandchronicle.com",
    "derbund.ch",
    "desmoinesregister.com",
    "detroitnews.com",
    "df.cl",
    "digitimes.com",
    "dispatch.com",
    "dn.se",
    "economictimes.com",
    "economictimes.indiatimes.com",
    "elmercurio.com",
    "epaper.indiatimes.com",
    "fd.nl",
    "femmesdaujourdhui.be",
    "flair.be",
    "freep.com",
    "freiepresse.de",
    "groene.nl",
    "handelsblatt.com",
    "hd.se",
    "hilltimes.com",
    "huffingtonpost.it",
    "ilmanifesto.it",
    "indystar.com",
    "infolibre.es",
    "italian.tech",
    "jacksonville.com",
    "jazzwise.com",
    "jsonline.com",
    "knack.be",
    "knoxnews.com",
    "kw.be",
    "ladiaria.com.uy",
    "lastampa.it",
    "law.com",
    "lecanardenchaine.fr",
    "lenouveleconomiste.fr",
    "leparisien.fr",
    "lescienze.it",
    "levif.be",
    "libelle.be",
    "linforme.com",
    "lopinion.fr",
    "moda.it",
    "monocle.com",
    "nbcnews.com",
    "news-press.com",
    "northjersey.com",
    "noz.de",
    "nyteknik.se",
    "oklahoman.com",
    "palmbeachpost.com",
    "polityka.pl",
    "project-syndicate.org",
    "railwaygazette.com",
    "repubblica.it",
    "rheinpfalz.de",
    "shz.de",
    "stratfor.com",
    "sydsvenskan.se",
    "tagesanzeiger.ch",
    "tdg.ch",
    "tennessean.com",
    "thebookseller.com",
    "tokyo-np.co.jp",
    "uol.com.br",
    "usatoday.com",
    "vibilagare.se",
    "washingtonpost.com",
    "weltkunst.de",
]);

const FACEBOOKBOT_DOMAINS = new Set([
    "bt.no",
    "citywire.com",
    "lagaceta.com.ar",
    "thediplomat.com",
    "wonderzine.com",
]);

const CUSTOM_USER_AGENTS = new Map<string, string>([
    ["businessdesk.co.nz", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
    ["dnevnik.bg", "Mozilla/5.0 (Java) outbrain"],
    ["economist.com", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.103 Mobile Safari/537.36 Liskov"],
    ["haaretz.co.il", "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Safari/537.36 haaretz/5.0.49"],
    ["haaretz.com", "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Safari/537.36 haaretz/5.0.49"],
    ["themarker.com", "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Safari/537.36 haaretz/5.0.49"],
    ["nytimes.com", "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)"],
]);

const GOOGLE_REFERER_DOMAINS = new Set([
    "ft.com",
    "investorschronicle.co.uk",
]);

const CUSTOM_REFERERS = new Map<string, string>([
    ["marketwatch.com", "https://www.drudgereport.com/"],
    ["wsj.com", "https://www.drudgereport.com/"],
]);

const CUSTOM_HEADERS = new Map<string, Record<string, string>>([
    ["haaretz.co.il", { ismobileapp: "true", platform: "app", renderingkind: "opened" }],
    ["haaretz.com", { ismobileapp: "true", platform: "app", renderingkind: "opened" }],
    ["themarker.com", { ismobileapp: "true", platform: "app", renderingkind: "opened" }],
]);

const RANDOM_IP_DOMAINS = new Set(["nationalgeographic.com"]);

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function findSetDomain(hostname: string, domains: Set<string>): string | null {
    for (const domain of domains) {
        if (matchesDomain(hostname, domain)) return domain;
    }
    return null;
}

function findMapValue<T>(hostname: string, values: Map<string, T>): T | undefined {
    for (const [domain, value] of values) {
        if (matchesDomain(hostname, domain)) return value;
    }
    return undefined;
}

function getProfile(url: string): BpcHttpProfile | null {
    let hostname: string;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }

    const userAgent = findMapValue(hostname, CUSTOM_USER_AGENTS);
    const referer = findMapValue(hostname, CUSTOM_REFERERS);
    const headers = findMapValue(hostname, CUSTOM_HEADERS);
    const userAgentMode: UserAgentMode | undefined = findSetDomain(hostname, GOOGLEBOT_DOMAINS)
        ? "googlebot"
        : findSetDomain(hostname, FACEBOOKBOT_DOMAINS)
        ? "facebookbot"
        : undefined;
    const googleReferer = findSetDomain(hostname, GOOGLE_REFERER_DOMAINS) !== null;
    const randomIpRegion = findSetDomain(hostname, RANDOM_IP_DOMAINS) ? "eu" : undefined;

    if (!userAgent && !referer && !headers && !userAgentMode && !googleReferer && !randomIpRegion) {
        return null;
    }

    return {
        userAgent,
        userAgentMode,
        referer: referer || (googleReferer ? "https://www.google.com/" : undefined),
        headers,
        randomIpRegion,
    };
}

export function hasBpcRequestProfile(url: string): boolean {
    return getProfile(url) !== null;
}

export function hasBpcCustomUserAgentProfile(url: string): boolean {
    return Boolean(getProfile(url)?.userAgent);
}

function resolveUserAgent(profile: BpcHttpProfile): string {
    if (profile.userAgent) return profile.userAgent;
    switch (profile.userAgentMode) {
        case "googlebot":
            return UA_GOOGLEBOT;
        case "bingbot":
            return UA_BINGBOT;
        case "facebookbot":
            return UA_FACEBOOKBOT;
        default:
            return UA_NORMAL;
    }
}

function randomEuIp(): string {
    // BPC uses X-Forwarded-For for this rule. Keep the spoofed address in a
    // broad European-looking range; it is only an HTTP header, never routed.
    return `80.${64 + Math.floor(Math.random() * 64)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
}

export async function fetchWithBpcProfile(
    url: string,
    signal?: AbortSignal,
): Promise<FetchResult> {
    const profile = getProfile(url);
    if (!profile) {
        return {
            success: false,
            error: "No server-compatible BPC HTTP profile for this domain",
            strategy: "bpc",
        };
    }

    const headers: Record<string, string> = {
        "User-Agent": resolveUserAgent(profile),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...profile.headers,
    };

    if (profile.referer) {
        headers.Referer = profile.referer;
    } else if (!profile.userAgent && !profile.userAgentMode) {
        // Match BPC's HTTP fallback behavior for non-UA rules.
        headers.Referer = "https://www.google.com/";
    }
    if (profile.randomIpRegion) headers["X-Forwarded-For"] = randomEuIp();

    try {
        const response = await fetch(url, { signal, headers, redirect: "follow" });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
                strategy: "bpc",
            };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (contentType && !contentType.includes("text/html")) {
            return {
                success: false,
                error: `Invalid content type: ${contentType}`,
                strategy: "bpc",
            };
        }

        return {
            success: true,
            html: await decodeResponse(response),
            strategy: "bpc",
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            strategy: "bpc",
        };
    }
}
