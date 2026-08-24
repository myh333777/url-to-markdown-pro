const DEFAULT_ENDPOINT = "http://127.0.0.1:8000";
const DEFAULT_SAMPLES = 3;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MIN_PASS_RATE = 0.85;
const MIN_CONTENT_LENGTH = 350;

const DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "cnn.com",
  "cnbc.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "ft.com",
  "economist.com",
  "scmp.com",
  "abcnews.com",
  "nbcnews.com",
  "cbsnews.com",
  "foxnews.com",
  "politico.com",
  "axios.com",
  "thehill.com",
  "npr.org",
  "time.com",
  "forbes.com",
  "businessinsider.com",
  "marketwatch.com",
  "barrons.com",
  "fortune.com",
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "arstechnica.com",
  "engadget.com",
  "cnet.com",
  "nature.com",
  "science.org",
  "scientificamerican.com",
  "newscientist.com",
  "statnews.com",
  "theatlantic.com",
  "newyorker.com",
  "foreignpolicy.com",
  "aljazeera.com",
  "dw.com",
  "france24.com",
  "asia.nikkei.com",
  "straitstimes.com",
  "thehindu.com",
  "indiatimes.com",
  "sfchronicle.com",
  "latimes.com",
  "bostonglobe.com",
  "usatoday.com",
  "newsweek.com",
  "pbs.org",
  "news.yahoo.com",
  "finance.yahoo.com",
  "investopedia.com",
  "seekingalpha.com",
  "morningstar.com",
  "technologyreview.com",
  "tomshardware.com",
  "zdnet.com",
  "theregister.com",
  "venturebeat.com",
  "fastcompany.com",
  "euronews.com",
  "rferl.org",
  "japantimes.co.jp",
  "koreatimes.co.kr",
  "smh.com.au",
  "abc.net.au",
  "caixinglobal.com",
  "caixin.com",
  "yicai.com",
  "36kr.com",
  "huxiu.com",
  "thepaper.cn",
  "infzm.com",
] as const;

type Status = "PASS" | "FAIL" | "FALSE_OK" | "TOO_SHORT" | "ERROR";

interface Job {
  domain: string;
  index: number;
  link: string;
  title: string;
}

interface Result extends Job {
  status: Status;
  http?: number;
  strategy?: string;
  elapsedMs?: number;
  contentLength?: number;
  quality?: number;
  wallMs: number;
  error?: string;
}

const INVALID_CONTENT_PATTERNS = [
  /client challenge/i,
  /a required part of this site couldn.?t load/i,
  /performing security verification/i,
  /unusual activity from your computer network/i,
  /data mine or scrape the content using automated means/i,
  /text and data mining activities/i,
  /content is made available for your personal, non-commercial use/i,
  /just a moment/i,
  /checking your browser/i,
  /are you a robot/i,
  /prove you.?re human/i,
  /subscribe.{0,20}to.{0,20}unlock/i,
  /subscribe.{0,20}to.{0,20}continue/i,
  /unlock unlimited access/i,
];

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const endpoint = (getArg("endpoint") || DEFAULT_ENDPOINT).replace(/\/$/, "");
const samples = Number(getArg("samples") || DEFAULT_SAMPLES);
const concurrency = Number(getArg("concurrency") || DEFAULT_CONCURRENCY);
const minPassRate = Number(getArg("min-pass-rate") || DEFAULT_MIN_PASS_RATE);

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function getGoogleNewsJobs(domain: string): Promise<Job[]> {
  const query = encodeURIComponent(`site:${domain} when:14d`);
  const url =
    `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, {
    headers: { "User-Agent": "URL2MD-site-matrix/1.0" },
  });
  if (!response.ok) throw new Error(`Google News RSS HTTP ${response.status}`);

  const xml = await response.text();
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(
    0,
    samples,
  );
  return itemMatches.flatMap((match, index) => {
    const item = match[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    if (!link) return [];
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    return [{
      domain,
      index: index + 1,
      link: decodeXml(link.trim()),
      title: decodeXml(title.trim()),
    }];
  });
}

async function testJob(job: Job): Promise<Result> {
  const startedAt = performance.now();
  const params = new URLSearchParams({
    url: job.link,
    bypass: "true",
    images: "false",
    strategy: "auto",
    format: "text",
  });

  try {
    const response = await fetch(`${endpoint}/api?${params}`);
    const body = await response.text();
    const invalid = INVALID_CONTENT_PATTERNS.some((pattern) =>
      pattern.test(body.slice(0, 10000))
    );

    let status: Status;
    if (response.ok && invalid) status = "FALSE_OK";
    else if (response.ok && body.length >= MIN_CONTENT_LENGTH) status = "PASS";
    else if (response.ok) status = "TOO_SHORT";
    else status = "FAIL";

    let error: string | undefined;
    if (!response.ok) {
      try {
        error = JSON.parse(body).error;
      } catch {
        error = body.slice(0, 180);
      }
    }

    return {
      ...job,
      status,
      http: response.status,
      strategy: response.headers.get("x-strategy-used") || undefined,
      elapsedMs: Number(response.headers.get("x-elapsed-ms") || 0) || undefined,
      contentLength: body.length,
      quality: Number(response.headers.get("x-content-quality") || 0) || undefined,
      wallMs: Math.round(performance.now() - startedAt),
      error,
    };
  } catch (error) {
    return {
      ...job,
      status: "ERROR",
      wallMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const rssResults = await Promise.allSettled(DOMAINS.map(getGoogleNewsJobs));
const jobs: Job[] = [];
for (let index = 0; index < rssResults.length; index++) {
  const result = rssResults[index];
  if (result.status === "fulfilled") {
    jobs.push(...result.value);
  } else {
    console.error(`[RSS] ${DOMAINS[index]}: ${result.reason}`);
  }
}

console.log(
  `Testing ${jobs.length} articles from ${DOMAINS.length} domains against ${endpoint}`,
);
const results = await mapConcurrent(jobs, concurrency, testJob);

for (const domain of DOMAINS) {
  const domainResults = results.filter((result) => result.domain === domain);
  if (domainResults.length === 0) continue;
  const counts = new Map<Status, number>();
  for (const result of domainResults) {
    counts.set(result.status, (counts.get(result.status) || 0) + 1);
  }
  const averageMs = Math.round(
    domainResults.reduce((sum, result) => sum + result.wallMs, 0) /
      domainResults.length,
  );
  console.log(
    `${domain.padEnd(22)} pass=${
      counts.get("PASS") || 0
    }/${domainResults.length} ` +
      `fail=${counts.get("FAIL") || 0} false=${counts.get("FALSE_OK") || 0} ` +
      `short=${counts.get("TOO_SHORT") || 0} err=${
        counts.get("ERROR") || 0
      } avg=${averageMs}ms`,
  );
}

const passed = results.filter((result) => result.status === "PASS").length;
const falseOk = results.filter((result) => result.status === "FALSE_OK").length;
const passRate = results.length ? passed / results.length : 0;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

const wallTimes = results.map((result) => result.wallMs);
const passWallTimes = results
  .filter((result) => result.status === "PASS")
  .map((result) => result.wallMs);
const strategyCounts = new Map<string, number>();
for (const result of results) {
  const strategy = result.strategy || "failed";
  strategyCounts.set(strategy, (strategyCounts.get(strategy) || 0) + 1);
}

console.log(
  `\nPASS ${passed}/${results.length} = ${(passRate * 100).toFixed(1)}%`,
);
console.log(`FALSE_OK ${falseOk}`);
console.log(
  `LATENCY all p50=${percentile(wallTimes, 0.5)}ms p95=${percentile(wallTimes, 0.95)}ms; ` +
    `pass p50=${percentile(passWallTimes, 0.5)}ms p95=${percentile(passWallTimes, 0.95)}ms`,
);
console.log(
  `STRATEGIES ${[...strategyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}=${count}`).join(" ")}`,
);

const nonPass = results.filter((result) => result.status !== "PASS");
if (nonPass.length) {
  console.log("\nNon-pass samples:");
  for (const result of nonPass) {
    console.log(
      `${result.domain} #${result.index} ${result.status} HTTP=${
        result.http ?? "-"
      } ` +
        `${result.strategy || "-"} ${result.wallMs}ms ${
          result.title.slice(0, 70)
        }`,
    );
    if (result.error) console.log(`  ${result.error.slice(0, 220)}`);
  }
}

if (falseOk > 0 || passRate < minPassRate) {
  console.error(
    `\nRegression gate failed: pass rate ${(passRate * 100).toFixed(1)}% ` +
      `(minimum ${
        (minPassRate * 100).toFixed(1)
      }%), false positives=${falseOk}`,
  );
  Deno.exit(1);
}
