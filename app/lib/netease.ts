import type { Track } from "@/app/lib/types";

export interface NeteaseSong {
  id: string;
  title: string;
  author: string;
  album: string;
  duration: string;
  picUrl: string;
  url: string;
  source: "netease";
}

const FETCH_TIMEOUT_MS = 8_000;
const NETEASE_SEARCH_CACHE_TTL_MS = 60_000;
const NETEASE_URL_CACHE_TTL_MS = 10 * 60_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 AustinMusic/1.0";

const searchCache = new Map<string, { expiresAt: number; result: { total: number; songs: NeteaseSong[] } }>();
const audioUrlCache = new Map<string, { expiresAt: number; url: string | null }>();

function clampLimit(limit: number) {
  return Math.max(1, Math.min(30, Number.isFinite(limit) ? limit : 10));
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function fetchJson<T>(url: string, headers?: HeadersInit): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Referer: "https://music.163.com/",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function neteaseAudioUrl(id: string) {
  return `/api/netease/audio/${encodeURIComponent(id)}`;
}

export function neteasePageUrl(id: string) {
  return `https://music.163.com/#/song?id=${encodeURIComponent(id)}`;
}

async function fetchNeteasePlayableUrls(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, string | null>();

  const now = Date.now();
  const result = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of uniqueIds) {
    const cached = audioUrlCache.get(id);
    if (cached && cached.expiresAt > now) {
      result.set(id, cached.url);
    } else {
      missing.push(id);
    }
  }

  if (missing.length) {
    const params = new URLSearchParams({
      ids: `[${missing.join(",")}]`,
      br: "320000",
    });
    const json = await fetchJson<{
      data?: Array<{ id?: number; url?: string | null; code?: number }>;
    }>(`https://music.163.com/api/song/enhance/player/url?${params.toString()}`, {
      Cookie: "os=pc; appver=2.9.7",
    });

    const data = json?.data ?? [];
    for (const id of missing) {
      const item = data.find((entry) => String(entry.id) === id);
      const url = item?.url && item.code !== 404 ? item.url : null;
      audioUrlCache.set(id, {
        expiresAt: now + NETEASE_URL_CACHE_TTL_MS,
        url,
      });
      result.set(id, url);
    }
  }

  return result;
}

export async function resolveNeteaseAudioUrl(id: string) {
  const urls = await fetchNeteasePlayableUrls([id]);
  return urls.get(id) ?? null;
}

export async function searchNeteaseSongs(query: string, limit = 10) {
  const q = query.trim();
  if (!q) return { total: 0, songs: [] };

  const safeLimit = clampLimit(limit);
  const cacheKey = `${q.toLowerCase()}::${safeLimit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const params = new URLSearchParams({
    s: q,
    type: "1",
    offset: "0",
    total: "true",
    limit: String(safeLimit),
  });
  const json = await fetchJson<{
    code?: number;
    result?: {
      songCount?: number;
      songs?: Array<{
        id?: number;
        name?: string;
        duration?: number;
        album?: { name?: string; picUrl?: string };
        artists?: Array<{ name?: string }>;
      }>;
    };
  }>(`https://music.163.com/api/search/get/web?${params.toString()}`);

  const rawSongs = json?.result?.songs ?? [];
  const mappedSongs: NeteaseSong[] = rawSongs
    .filter((song) => song.id && song.name)
    .map((song) => {
      const id = String(song.id);
      const author = (song.artists ?? []).map((artist) => artist.name).filter(Boolean).join(" / ");
      return {
        id,
        title: song.name ?? id,
        author,
        album: song.album?.name ?? "",
        duration: formatDuration(song.duration ?? 0),
        picUrl: song.album?.picUrl ?? "",
        url: neteaseAudioUrl(id),
        source: "netease" as const,
      };
    });
  const playableUrls = await fetchNeteasePlayableUrls(mappedSongs.map((song) => song.id));
  const songs = mappedSongs.filter((song) => playableUrls.get(song.id));

  const result = { total: json?.result?.songCount ?? songs.length, songs };
  searchCache.set(cacheKey, {
    expiresAt: Date.now() + NETEASE_SEARCH_CACHE_TTL_MS,
    result,
  });
  return result;
}

export function neteaseSongToTrack(song: NeteaseSong): Track {
  return {
    id: `netease/${song.id}`,
    title: song.title,
    author: song.author,
    date: "",
    filename: "",
    subDir: "",
    size: 0,
    url: song.url,
    format: "netease",
    mimeType: "audio/mpeg",
    neteaseId: song.id,
    source: "netease",
    duration: song.duration,
  };
}
