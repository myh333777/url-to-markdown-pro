/**
 * Lightweight server-side routing hints derived from the local
 * Bypass Paywalls Clean `sites.js` rule set (MIT licensed).
 *
 * Only rules that translate cleanly to server-side HTTP are used here.
 * Browser-only script blocking, DOM rewrites and cookie manipulation remain
 * outside URL2MD and can be handled by a future local-browser fallback.
 */

export type RoutedStrategy =
    | "direct"
    | "bpc"
    | "wreq"
    | "googlebot"
    | "facebookbot"
    | "bingbot"
    | "google-referer"
    | "exa"
    | "jina";

export interface SiteRoute {
    primary: RoutedStrategy[];
    fallback: RoutedStrategy[];
}
const GOOGLEBOT_DOMAINS = new Set([
    "berliner-zeitung.de",
    "businessinsider.com",
    "dagsavisen.no",
    "df.cl",
    "rheinpfalz.de",
    "elmercurio.com",
    "freiepresse.de",
    "groene.nl",
    "handelsblatt.com",
    "ilmanifesto.it",
    "infolibre.es",
    "jazzwise.com",
    "linforme.com",
    "lopinion.fr",
    "ladiaria.com.uy",
    "law.com",
    "lecanardenchaine.fr",
    "lenouveleconomiste.fr",
    "leparisien.fr",
    "monocle.com",
    "nbcnews.com",
    "nyteknik.se",
    "ostdeutscheallgemeine.com",
    "polityka.pl",
    "project-syndicate.org",
    "stratfor.com",
    "ajc.com",
    "dallasnews.com",
    "hilltimes.com",
    "sfstandard.com",
    "washingtonpost.com",
    "uol.com.br",
    "usatoday.com",
    "vibilagare.se",
    "weltkunst.de",
    "wiwo.de",
]);

const FACEBOOKBOT_DOMAINS = new Set([
    "bt.no",
    "citywire.com",
    "lagaceta.com.ar",
    "thediplomat.com",
    "wonderzine.com",
]);

const GOOGLE_REFERER_DOMAINS = new Set([
    "ft.com",
    "investorschronicle.co.uk",
]);

const WREQ_DOMAINS = new Set([
    "fastcompany.com",
    "morningstar.com",
    "pbs.org",
    "reuters.com",
    "thehill.com",
    "euronews.com",
]);

function matchesDomain(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesAny(hostname: string, domains: Set<string>): boolean {
    for (const domain of domains) {
        if (matchesDomain(hostname, domain)) return true;
    }
    return false;
}

export function getSiteRoute(url: string): SiteRoute {
    let hostname = "";
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return { primary: ["direct"], fallback: ["exa", "jina"] };
    }

    // Reuters rejects ordinary data-center HTTP clients but accepts a request
    // with a genuine Chrome TLS/HTTP2 fingerprint. Prefer that low-cost path
    // before the syndicated-copy recovery below.
    if (matchesDomain(hostname, "reuters.com")) {
        return { primary: ["wreq"], fallback: ["exa", "jina"] };
    }

    // Economist exposes the complete server-rendered article to the
    // mobile/Liskov request profile used by Bypass Paywalls Clean. Prefer it
    // directly instead of spending time on bot and reader fallbacks first.
    if (matchesDomain(hostname, "economist.com")) {
        return { primary: ["bpc"], fallback: ["exa", "jina"] };
    }

    if (matchesAny(hostname, WREQ_DOMAINS)) {
        return { primary: ["direct", "wreq"], fallback: ["exa", "jina"] };
    }

    if (matchesAny(hostname, GOOGLE_REFERER_DOMAINS)) {
        return { primary: ["direct", "google-referer"], fallback: ["exa", "jina"] };
    }

    if (matchesAny(hostname, FACEBOOKBOT_DOMAINS)) {
        return { primary: ["direct", "facebookbot"], fallback: ["exa", "jina"] };
    }

    if (matchesAny(hostname, GOOGLEBOT_DOMAINS)) {
        return { primary: ["direct", "googlebot"], fallback: ["exa", "jina"] };
    }

    // Unknown sites keep a small generic race. Only after that fails do two
    // higher-cost reader services race, replacing the older four-service
    // cascade while covering complementary failure modes.
    return {
        primary: ["direct", "bingbot", "googlebot"],
        fallback: ["exa", "jina"],
    };
}

export function supportsWreqUrl(url: string): boolean {
    try {
        return matchesAny(new URL(url).hostname.toLowerCase(), WREQ_DOMAINS);
    } catch {
        return false;
    }
}
