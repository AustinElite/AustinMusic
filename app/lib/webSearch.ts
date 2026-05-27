export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

const WEB_SEARCH_CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 AustinMusic/1.0";

const webSearchCache = new Map<string, { expiresAt: number; results: WebSearchResult[] }>();

function clampLimit(limit: number) {
  return Math.max(1, Math.min(20, Number.isFinite(limit) ? limit : 8));
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeDuckDuckGoUrl(rawHref: string) {
  try {
    const href = decodeHtml(rawHref);
    const url = new URL(href, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    const finalUrl = redirected ? decodeURIComponent(redirected) : url.href;
    if (!/^https?:\/\//i.test(finalUrl)) return null;
    if (new URL(finalUrl).hostname.includes("duckduckgo.com")) return null;
    return finalUrl;
  } catch {
    return null;
  }
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function addResult(
  results: WebSearchResult[],
  seen: Set<string>,
  href: string,
  rawTitle: string,
  rawSnippet = ""
) {
  const url = normalizeDuckDuckGoUrl(href);
  const title = stripHtml(rawTitle);
  if (!url || !title || seen.has(url)) return;

  seen.add(url);
  results.push({
    title,
    url,
    snippet: stripHtml(rawSnippet),
    source: sourceFromUrl(url),
  });
}

function parseDuckDuckGoHtml(html: string, limit: number) {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const normalizedLimit = clampLimit(limit);

  const resultBlockRe = /<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>)/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = resultBlockRe.exec(html)) && results.length < normalizedLimit) {
    const block = blockMatch[0];
    const titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    addResult(results, seen, titleMatch[1]!, titleMatch[2]!, snippetMatch?.[1] ?? "");
  }

  const looseLinkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = looseLinkRe.exec(html)) && results.length < normalizedLimit) {
    addResult(results, seen, linkMatch[1]!, linkMatch[2]!);
  }

  return results;
}

function parseBingHtml(html: string, limit: number) {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const normalizedLimit = clampLimit(limit);

  const blocks = html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    if (results.length >= normalizedLimit) break;
    const titleMatch =
      block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const snippetMatch =
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/class="[^"]*\bb_caption\b[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);

    addResult(results, seen, titleMatch[1]!, titleMatch[2]!, snippetMatch?.[1] ?? "");
  }

  return results;
}

export async function searchWeb(query: string, limit = 8) {
  const q = query.trim();
  if (!q) return [];

  const normalizedLimit = clampLimit(limit);
  const cacheKey = `${q.toLowerCase()}::${normalizedLimit}`;
  const cached = webSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const bingParams = new URLSearchParams({ q, count: String(normalizedLimit) });
  const duckParams = new URLSearchParams({ q });

  const bingHtml = await fetchText(`https://www.bing.com/search?${bingParams.toString()}`);
  let results = bingHtml ? parseBingHtml(bingHtml, normalizedLimit) : [];

  if (!results.length) {
    const duckHtml =
      (await fetchText(`https://duckduckgo.com/html/?${duckParams.toString()}`)) ||
      (await fetchText(`https://lite.duckduckgo.com/lite/?${duckParams.toString()}`));
    results = duckHtml ? parseDuckDuckGoHtml(duckHtml, normalizedLimit) : [];
  }

  webSearchCache.set(cacheKey, {
    expiresAt: Date.now() + WEB_SEARCH_CACHE_TTL_MS,
    results,
  });

  return results;
}
