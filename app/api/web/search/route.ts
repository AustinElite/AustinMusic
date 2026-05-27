import { NextRequest } from "next/server";
import { searchVideos } from "@/app/lib/bili";
import { neteaseSongToTrack, searchNeteaseSongs } from "@/app/lib/netease";
import { searchWeb } from "@/app/lib/webSearch";

export const dynamic = "force-dynamic";

function safeLimit(value: string | null) {
  const parsed = Number(value);
  return Math.max(1, Math.min(20, Number.isFinite(parsed) ? parsed : 8));
}

function rawQueryParam(url: string, keys: string[]) {
  const query = url.split("?")[1] ?? "";
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    if (keys.includes(key)) return eq >= 0 ? pair.slice(eq + 1) : "";
  }
  return null;
}

function bytesFromFormValue(raw: string) {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch === "+") {
      bytes.push(0x20);
      continue;
    }
    if (ch === "%" && /^[0-9a-f]{2}$/i.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    for (const byte of Buffer.from(ch, "utf8")) bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

function repairLatin1Utf8(value: string) {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

function scoreQuery(value: string) {
  if (!value.trim()) return -100;
  const cjk = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const replacement = (value.match(/\uFFFD/g) ?? []).length;
  const mojibake = (value.match(/[ÃÂåæäçèé銆]/g) ?? []).length;
  return cjk * 4 - replacement * 8 - mojibake * 2 - Math.max(0, value.length - 80) * 0.05;
}

function decodeBase64Query(raw: string | null) {
  if (!raw) return "";
  try {
    const normalized = raw.replace(/\+/g, " ").replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(decodeURIComponent(normalized), "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function resolveSearchQuery(req: NextRequest) {
  const q64 = decodeBase64Query(rawQueryParam(req.url, ["q64", "keyword64"]));
  if (q64) return q64;

  const fromUrlSearch = (req.nextUrl.searchParams.get("q") ?? req.nextUrl.searchParams.get("keyword") ?? "").trim();
  const raw = rawQueryParam(req.url, ["q", "keyword"]);
  if (!raw) return fromUrlSearch;

  const bytes = bytesFromFormValue(raw);
  const candidates = [
    fromUrlSearch,
    new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    new TextDecoder("gb18030", { fatal: false }).decode(bytes),
    repairLatin1Utf8(fromUrlSearch),
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  return candidates.sort((a, b) => scoreQuery(b) - scoreQuery(a))[0] ?? fromUrlSearch;
}

export async function GET(req: NextRequest) {
  const q = resolveSearchQuery(req);
  const limit = safeLimit(req.nextUrl.searchParams.get("limit"));
  const page = Number(req.nextUrl.searchParams.get("page")) || 1;
  const source = (req.nextUrl.searchParams.get("source") ?? "all").toLowerCase();

  if (!q) {
    return Response.json({ error: "q is required", total: 0, results: [], videos: [] }, { status: 400 });
  }

  const includeWeb = source === "all" || source === "web";
  const includeBili = source === "all" || source === "bili" || source === "video";
  const includeNetease = source === "all" || source === "netease" || source === "music";
  const errors: string[] = [];

  const [webSettled, biliSettled, neteaseSettled] = await Promise.allSettled([
    includeWeb ? searchWeb(q, limit) : Promise.resolve([]),
    includeBili ? searchVideos(q, page) : Promise.resolve({ total: 0, videos: [] }),
    includeNetease ? searchNeteaseSongs(q, limit) : Promise.resolve({ total: 0, songs: [] }),
  ]);

  const results = webSettled.status === "fulfilled" ? webSettled.value : [];
  if (webSettled.status === "rejected") errors.push(`web: ${String(webSettled.reason)}`);

  const bili = biliSettled.status === "fulfilled" ? biliSettled.value : { total: 0, videos: [] };
  if (biliSettled.status === "rejected") errors.push(`bili: ${String(biliSettled.reason)}`);

  const netease = neteaseSettled.status === "fulfilled" ? neteaseSettled.value : { total: 0, songs: [] };
  if (neteaseSettled.status === "rejected") errors.push(`netease: ${String(neteaseSettled.reason)}`);

  const videos = bili.videos.slice(0, limit).map((video) => ({
    ...video,
    source: "bilibili",
    url: `https://www.bilibili.com/video/${video.bvid}`,
  }));
  const songs = netease.songs.slice(0, limit);
  const tracks = songs.map(neteaseSongToTrack);

  return Response.json(
    {
      query: q,
      total: results.length + videos.length + songs.length,
      results,
      videos,
      songs,
      tracks,
      errors,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    }
  );
}
