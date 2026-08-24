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

    // Reuters currently rejects data-center crawlers with DataDome 401.
    // A quick direct probe followed by Exa's syndicated-copy recovery is the
    // best speed/success tradeoff observed in production.
    if (matchesDomain(hostname, "reuters.com")) {
        return { primary: ["direct"], fallback: ["exa", "jina"] };
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
