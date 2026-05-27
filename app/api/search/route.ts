import { NextRequest } from "next/server";
import { searchTracks } from "@/app/lib/tracks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 20;
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  const result = await searchTracks(q, limit, { force });

  return Response.json(result, {
    headers: {
      "Cache-Control": "private, max-age=5",
    },
  });
}
