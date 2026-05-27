import { NextRequest } from "next/server";
import path from "path";
import { clearTrackCache, MUSIC_DIR, scanTrackDirectory } from "@/app/lib/tracks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const subDir = req.nextUrl.searchParams.get("subDir")?.trim();
  if (!subDir) {
    return Response.json({ error: "subDir is required" }, { status: 400 });
  }

  const dirPath = path.resolve(/* turbopackIgnore: true */ MUSIC_DIR, subDir);
  const relative = path.relative(MUSIC_DIR, dirPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return Response.json({ error: "invalid subDir" }, { status: 403 });
  }

  const tracks = await scanTrackDirectory(subDir);
  clearTrackCache();

  return Response.json({ tracks });
}
