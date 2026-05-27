import { NextRequest } from "next/server";
import { neteaseSongToTrack, searchNeteaseSongs } from "@/app/lib/netease";

export const dynamic = "force-dynamic";

function safeLimit(value: string | null) {
  const parsed = Number(value);
  return Math.max(1, Math.min(30, Number.isFinite(parsed) ? parsed : 10));
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? req.nextUrl.searchParams.get("keyword") ?? "").trim();
  const limit = safeLimit(req.nextUrl.searchParams.get("limit"));

  if (!q) {
    return Response.json({ error: "q is required", total: 0, songs: [], tracks: [] }, { status: 400 });
  }

  const result = await searchNeteaseSongs(q, limit);
  return Response.json(
    {
      query: q,
      total: result.total,
      songs: result.songs,
      tracks: result.songs.map(neteaseSongToTrack),
    },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    }
  );
}
