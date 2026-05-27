import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const ID_RE = /^\d+$/;
const FETCH_TIMEOUT_MS = 8_000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AustinMusic/1.0 netease lyric",
        Accept: "application/json,text/plain,*/*",
        Referer: "https://music.163.com/",
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return new Response("invalid id", { status: 400 });

  const query = new URLSearchParams({ id, lv: "1", kv: "1", tv: "-1" });
  const json = await fetchJson<{ lrc?: { lyric?: string }; klyric?: { lyric?: string }; tlyric?: { lyric?: string } }>(
    `https://music.163.com/api/song/lyric?${query.toString()}`
  );
  const lyric = json?.lrc?.lyric || json?.klyric?.lyric || json?.tlyric?.lyric || "";
  if (!lyric.trim()) return new Response("not found", { status: 404 });

  return new Response(lyric, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Lyric-Format": "netease",
    },
  });
}
