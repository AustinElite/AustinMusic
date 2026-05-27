import { readdir, stat } from "fs/promises";
import path from "path";
import type { Track } from "./types";

const MUSIC_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.MUSIC_DIR || path.join(process.env.HOME || "", "Documents/bili")
);
const TRACK_CACHE_TTL_MS = 15_000;
const AUDIO_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

export const SUPPORTED_AUDIO_EXTENSIONS = Object.keys(AUDIO_MIME_TYPES);

type TrackSearchEntry = {
  track: Track;
  text: string;
  title: string;
  author: string;
  filename: string;
};

let trackCache:
  | {
      expiresAt: number;
      tracks: Track[];
      entries: TrackSearchEntry[];
    }
  | null = null;

function isInsideMusicDir(fullPath: string): boolean {
  const relative = path.relative(MUSIC_DIR, fullPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function clearTrackCache() {
  trackCache = null;
}

export function isSupportedAudioFile(filename: string): boolean {
  return Boolean(AUDIO_MIME_TYPES[path.extname(filename).toLowerCase()]);
}

export function getAudioMimeType(filename: string): string {
  return AUDIO_MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function stripAudioExtension(filename: string): string {
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function isYear(s: string): boolean {
  return /^\d{4}$/.test(s) && s >= "1990" && s <= "2030";
}

function isNum(s: string): boolean {
  return /^\d{1,2}$/.test(s);
}

export function parseName(name: string): { title: string; author: string; date: string; bvid: string } {
  // 从文件名中提取 _BV 后缀（用于搜索），解析标题时不包含 bvid
  let bvid = "";
  const bvidMatch = name.match(/[_ ]BV([A-Za-z0-9]+)$/);
  if (bvidMatch) {
    bvid = `BV${bvidMatch[1]}`;
    name = name.slice(0, -bvidMatch[0].length);
  }

  const parts = name.split("-");
  const n = parts.length;

  if (n >= 4) {
    const [y, m, d] = [parts[n - 3], parts[n - 2], parts[n - 1]];
    if (isYear(y) && isNum(m) && isNum(d)) {
      const date = `${y}-${m}-${d}`;
      if (n >= 5) {
        return {
          title: parts.slice(0, n - 4).join("-").trim(),
          author: parts[n - 4].trim(),
          date,
          bvid,
        };
      }
      return { title: parts.slice(0, n - 3).join("-").trim(), author: "", date, bvid };
    }
  }

  return { title: name, author: "", date: "", bvid };
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildTrackSearchEntry(track: Track): TrackSearchEntry {
  const title = normalizeSearchText(track.title);
  const author = normalizeSearchText(track.author);
  const filename = normalizeSearchText(track.filename);

  return {
    track,
    title,
    author,
    filename,
    text: normalizeSearchText([track.title, track.author, track.filename, track.bvid ?? ""].join(" ")),
  };
}

export async function trackFromFile(subDir: string, filename: string): Promise<Track> {
  const filePath = path.join(MUSIC_DIR, subDir, filename);
  let size = 0;
  try {
    const s = await stat(filePath);
    size = s.size;
  } catch { /* ignore */ }

  const extension = path.extname(filename).toLowerCase();
  const baseName = stripAudioExtension(filename);
  const { title, author, date, bvid } = parseName(baseName);

  return {
    id: `${subDir}/${filename}`,
    title,
    author,
    date,
    filename,
    subDir,
    size,
    format: extension.replace(".", ""),
    mimeType: getAudioMimeType(filename),
    ...(bvid ? { bvid } : {}),
    url: `/api/tracks/${encodeURIComponent(subDir)}/${encodeURIComponent(filename)}`,
  };
}

export async function scanTrackDirectory(subDir: string): Promise<Track[]> {
  const dirPath = path.resolve(/* turbopackIgnore: true */ MUSIC_DIR, subDir);
  if (!isInsideMusicDir(dirPath)) return [];

  let files;
  try {
    files = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const tracks = await Promise.all(
    files
      .filter((f) => !f.isDirectory() && isSupportedAudioFile(f.name))
      .map((f) => trackFromFile(subDir, f.name))
  );

  return tracks.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
}

function scoreTrack(entry: TrackSearchEntry, query: string): number {
  if (!query) return 1;
  if (entry.title === query || entry.author === query) return 120;
  if (entry.title.startsWith(query)) return 90;
  if (entry.author.startsWith(query)) return 82;
  if (entry.title.includes(query)) return 70;
  if (entry.author.includes(query)) return 62;
  if (entry.filename.includes(query)) return 52;
  if (entry.text.includes(query)) return 44;

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => entry.text.includes(token))) {
    return 36;
  }

  return 0;
}

export async function scanTracks(options?: { force?: boolean }): Promise<Track[]> {
  if (!options?.force && trackCache && trackCache.expiresAt > Date.now()) {
    return trackCache.tracks;
  }

  const tracks: Track[] = [];

  let dirs;
  try {
    dirs = await readdir(MUSIC_DIR, { withFileTypes: true });
  } catch {
    return tracks;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const subDir = dir.name;

    tracks.push(...await scanTrackDirectory(subDir));
  }

  tracks.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
  trackCache = {
    expiresAt: Date.now() + TRACK_CACHE_TTL_MS,
    tracks,
    entries: tracks.map(buildTrackSearchEntry),
  };

  return tracks;
}

export async function searchTracks(
  query: string,
  limit = 20,
  options?: { force?: boolean }
): Promise<{ total: number; tracks: Track[] }> {
  await scanTracks(options);
  const entries = trackCache?.entries ?? [];
  const normalizedQuery = normalizeSearchText(query);
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 20));

  const ranked = entries
    .map((entry) => ({ entry, score: scoreTrack(entry, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.track.title.localeCompare(b.entry.track.title, "zh-Hans-CN"));

  return {
    total: ranked.length,
    tracks: ranked.slice(0, safeLimit).map((item) => item.entry.track),
  };
}

export function resolveMusicPath(relativePath: string): string | null {
  const full = path.resolve(/* turbopackIgnore: true */ MUSIC_DIR, relativePath);
  if (!isInsideMusicDir(full)) return null;
  if (!isSupportedAudioFile(full)) return null;
  return full;
}

export { MUSIC_DIR };
