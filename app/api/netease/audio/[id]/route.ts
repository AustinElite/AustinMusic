import { NextRequest } from "next/server";
import { resolveNeteaseAudioUrl } from "@/app/lib/netease";

export const dynamic = "force-dynamic";

const ID_RE = /^\d+$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return new Response("invalid id", { status: 400 });

  const url = await resolveNeteaseAudioUrl(id);
  if (!url) {
    return new Response("netease audio is not playable or requires authorization", {
      status: 404,
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const headers = new Headers({
    "User-Agent": "AustinMusic/1.0 netease audio",
    Referer: "https://music.163.com/",
    Accept: "audio/mpeg,audio/*,*/*",
  });
  const range = _req.headers.get("range");
  if (range) headers.set("Range", range);

  const upstream = await fetch(url, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("failed to fetch netease audio", { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }
  if (!responseHeaders.has("content-type")) responseHeaders.set("content-type", "audio/mpeg");
  responseHeaders.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
