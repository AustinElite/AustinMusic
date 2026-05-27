import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { inflateSync } from "zlib";
import { MUSIC_DIR, parseName, SUPPORTED_AUDIO_EXTENSIONS } from "@/app/lib/tracks";

export const dynamic = "force-dynamic";

const LYRIC_EXTENSIONS = [".lrc", ".txt", ".krc"];
const FETCH_TIMEOUT_MS = 8_000;
const KRC_KEY = Buffer.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105]);

type LyricQuery = {
  rawTitle: string;
  title: string;
  artist: string;
};

function resolveLyricBasePath(relativePath: string) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!LYRIC_EXTENSIONS.includes(ext)) return null;

  const full = path.resolve(/* turbopackIgnore: true */ MUSIC_DIR, relativePath);
  const relative = path.relative(MUSIC_DIR, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return full.slice(0, -ext.length);
}

function formatLrcTime(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const centiseconds = Math.floor((safeMs % 1000) / 10);
  return `[${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}]`;
}

function convertKrcToLrc(raw: string) {
  const lines: string[] = [];

  for (const row of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = row.trim();
    if (!line) continue;

    const timed = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (timed) {
      const text = (timed[3] ?? "").replace(/<\d+,\d+,\d+>/g, "").trim();
      if (text) lines.push(`${formatLrcTime(Number(timed[1]))}${text}`);
      continue;
    }

    if (/^\[(ar|ti|al|by|offset):/i.test(line) || /^\[\d{1,2}:\d{2}/.test(line)) {
      lines.push(line);
    }
  }

  return cleanupLyricText(lines.join("\n"));
}

function decodeKrc(buffer: Buffer) {
  let raw: string;
  if (buffer.subarray(0, 4).toString("latin1") === "krc1") {
    const payload = Buffer.from(buffer.subarray(4));
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i]! ^ KRC_KEY[i % KRC_KEY.length]!;
    }
    raw = inflateSync(payload).toString("utf8");
  } else {
    raw = buffer.toString("utf8");
  }

  return convertKrcToLrc(raw);
}

async function findCompanionKrc(basePath: string) {
  try {
    const baseName = path.basename(basePath).toLowerCase();
    const files = await readdir(path.dirname(basePath), { withFileTypes: true });
    const match = files
      .filter((file) => !file.isDirectory() && path.extname(file.name).toLowerCase() === ".krc")
      .map((file) => file.name)
      .filter((name) => {
        const stem = path.basename(name, path.extname(name)).toLowerCase();
        return stem === baseName || stem.startsWith(`${baseName}-`) || stem.startsWith(`${baseName}_`);
      })
      .sort((a, b) => a.length - b.length)[0];

    return match ? path.join(path.dirname(basePath), match) : null;
  } catch {
    return null;
  }
}

async function readKrcLyric(filePath: string, basePath: string) {
  try {
    const text = decodeKrc(await readFile(/* turbopackIgnore: true */ filePath));
    if (!text) return null;

    try {
      await writeFile(/* turbopackIgnore: true */ `${basePath}.lrc`, text, "utf8");
    } catch {
      // The decoded lyric can still be displayed even if local caching fails.
    }

    return { text, extension: ".krc" };
  } catch {
    return null;
  }
}

async function readFirstExistingLyric(basePath: string) {
  for (const ext of [".lrc", ".txt"]) {
    try {
      return {
        text: await readFile(/* turbopackIgnore: true */ `${basePath}${ext}`, "utf8"),
        extension: ext,
      };
    } catch {
      // try next lyric format
    }
  }

  const exactKrc = await readKrcLyric(`${basePath}.krc`, basePath);
  if (exactKrc) return exactKrc;

  const companionKrc = await findCompanionKrc(basePath);
  return companionKrc ? readKrcLyric(companionKrc, basePath) : null;
}

function cleanupLyricText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function stripVersionTags(value: string) {
  return value
    .replace(/[_ ]BV[A-Za-z0-9]+$/i, "")
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*版）|\([^)]*版\)/g, " ")
    .replace(/\b(official|mv|live|lyrics?|audio|完整版|官方|字幕|伴奏|cover|翻唱)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lyricQueryFromPath(basePath: string): LyricQuery {
  const stem = path.basename(basePath);
  const parsed = parseName(stem);
  const rawTitle = parsed.title || stem;
  let title = rawTitle;
  let artist = parsed.author;

  const dashParts = rawTitle.split(/\s+-\s+/);
  if (!artist && dashParts.length >= 2) {
    artist = dashParts[0]!.trim();
    title = dashParts.slice(1).join(" - ").trim();
  }

  return {
    rawTitle,
    title: stripVersionTags(title || rawTitle),
    artist: stripVersionTags(artist),
  };
}

async function fetchJson(url: string, headers?: HeadersInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AustinMusic/1.0 lyric lookup",
        Accept: "application/json,text/plain,*/*",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLrcLibLyrics(query: LyricQuery) {
  const params = new URLSearchParams();
  params.set("track_name", query.title || query.rawTitle);
  if (query.artist) params.set("artist_name", query.artist);

  const json = await fetchJson(`https://lrclib.net/api/search?${params.toString()}`);
  if (!Array.isArray(json)) return null;

  const best = json.find((item) => item?.syncedLyrics || item?.plainLyrics);
  const text = cleanupLyricText(best?.syncedLyrics || best?.plainLyrics || "");
  return text ? { text, source: "lrclib" } : null;
}

function scoreNeteaseSong(song: Record<string, unknown>, query: LyricQuery) {
  const name = String(song.name ?? "").toLowerCase();
  const artists = Array.isArray(song.artists)
    ? song.artists.map((artist) => String((artist as Record<string, unknown>).name ?? "")).join(" ").toLowerCase()
    : "";
  const title = query.title.toLowerCase();
  const artist = query.artist.toLowerCase();

  let score = 0;
  if (name === title) score += 60;
  if (name.includes(title) || title.includes(name)) score += 35;
  if (artist && artists.includes(artist)) score += 30;
  return score;
}

async function fetchNeteaseLyrics(query: LyricQuery) {
  const params = new URLSearchParams({
    s: query.artist ? `${query.artist} ${query.title}` : query.title || query.rawTitle,
    type: "1",
    offset: "0",
    total: "true",
    limit: "8",
  });

  const search = await fetchJson(`https://music.163.com/api/search/get/web?${params.toString()}`, {
    Referer: "https://music.163.com/",
  });
  const songs = search?.result?.songs;
  if (!Array.isArray(songs) || !songs.length) return null;

  const best = [...songs]
    .filter((song) => song?.id)
    .sort((a, b) => scoreNeteaseSong(b, query) - scoreNeteaseSong(a, query))[0];
  if (!best?.id) return null;

  const lyric = await fetchJson(
    `https://music.163.com/api/song/lyric?${new URLSearchParams({
      id: String(best.id),
      lv: "1",
      kv: "1",
      tv: "-1",
    }).toString()}`,
    { Referer: "https://music.163.com/" }
  );
  const text = cleanupLyricText(lyric?.lrc?.lyric || lyric?.klyric?.lyric || lyric?.tlyric?.lyric || "");
  return text ? { text, source: "netease" } : null;
}

async function fetchRemoteLyrics(basePath: string) {
  const query = lyricQueryFromPath(basePath);
  if (!query.title && !query.rawTitle) return null;

  const lyric = (await fetchLrcLibLyrics(query)) ?? (await fetchNeteaseLyrics(query));
  if (!lyric?.text) return null;

  try {
    await writeFile(/* turbopackIgnore: true */ `${basePath}.lrc`, lyric.text, "utf8");
  } catch {
    // The lyric can still be displayed even if local caching fails.
  }

  return lyric;
}

function readSyncSafeInt(buffer: Buffer, offset: number) {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function decodeTextFrame(buffer: Buffer) {
  const encoding = buffer[0];
  const content = buffer.subarray(1);
  if (encoding === 1) return new TextDecoder("utf-16").decode(content).replace(/^\uFEFF/, "");
  if (encoding === 2) return new TextDecoder("utf-16be").decode(content);
  if (encoding === 3) return new TextDecoder("utf-8").decode(content);
  return new TextDecoder("latin1").decode(content);
}

function stripUsltHeader(buffer: Buffer) {
  const encoding = buffer[0];
  const step = encoding === 1 || encoding === 2 ? 2 : 1;
  let offset = 4;

  while (offset < buffer.length - step) {
    if (step === 2 && buffer[offset] === 0 && buffer[offset + 1] === 0) return buffer.subarray(offset + 2);
    if (step === 1 && buffer[offset] === 0) return buffer.subarray(offset + 1);
    offset += step;
  }

  return buffer.subarray(4);
}

async function readEmbeddedMp3Lyrics(basePath: string) {
  for (const ext of [".mp3", ".m4a", ".aac"]) {
    try {
      const buffer = await readFile(/* turbopackIgnore: true */ `${basePath}${ext}`);
      if (buffer.subarray(0, 3).toString("latin1") !== "ID3") continue;

      const version = buffer[3];
      const tagSize = readSyncSafeInt(buffer, 6);
      let offset = 10;
      const tagEnd = Math.min(buffer.length, 10 + tagSize);

      while (offset + 10 <= tagEnd) {
        const frameId = buffer.subarray(offset, offset + 4).toString("latin1");
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

        const frameSize = version === 4
          ? readSyncSafeInt(buffer, offset + 4)
          : buffer.readUInt32BE(offset + 4);
        const frameStart = offset + 10;
        const frameEnd = frameStart + frameSize;
        if (frameSize <= 0 || frameEnd > tagEnd) break;

        if (frameId === "USLT" || frameId === "SYLT") {
          const frame = buffer.subarray(frameStart, frameEnd);
          const text = decodeTextFrame(Buffer.concat([frame.subarray(0, 1), stripUsltHeader(frame)])).trim();
          if (text) return { text, extension: "id3" };
        }

        offset = frameEnd;
      }
    } catch {
      // try next audio extension
    }
  }

  for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
    if (ext === ".mp3" || ext === ".m4a" || ext === ".aac") continue;
    try {
      await readFile(/* turbopackIgnore: true */ `${basePath}${ext}`);
      break;
    } catch {
      // no matching audio file
    }
  }

  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const relativePath = segments.map(decodeURIComponent).join("/");
  const basePath = resolveLyricBasePath(relativePath);

  if (!basePath) {
    return new Response("forbidden", { status: 403 });
  }

  const lyric = await readFirstExistingLyric(basePath);
  if (lyric) {
    return new Response(lyric.text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, max-age=30",
        "X-Lyric-Format": lyric.extension.slice(1),
      },
    });
  }

  const embedded = await readEmbeddedMp3Lyrics(basePath);
  if (embedded) {
    return new Response(embedded.text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, max-age=30",
        "X-Lyric-Format": embedded.extension,
      },
    });
  }

  const remote = await fetchRemoteLyrics(basePath);
  if (remote) {
    return new Response(remote.text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, max-age=30",
        "X-Lyric-Format": remote.source,
      },
    });
  }

  return new Response("not found", { status: 404 });
}
