import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { mkdir, readdir, rename, stat } from "fs/promises";
import path from "path";
import {
  clearTrackCache,
  isSupportedAudioFile,
  MUSIC_DIR,
  scanTrackDirectory,
} from "@/app/lib/tracks";
import type { Track } from "@/app/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type DownloadVideo = {
  bvid: string;
  title?: string;
  author?: string;
  url?: string;
};

type AudioEntry = {
  name: string;
  mtimeMs: number;
};

const BVID_RE = /^BV[A-Za-z0-9]+$/;
const MAX_BATCH_SIZE = 10;

function todaySubDir() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function normalizeVideo(input: unknown): DownloadVideo | null {
  if (!input || typeof input !== "object") return null;
  const item = input as Record<string, unknown>;
  const bvid = typeof item.bvid === "string" ? item.bvid.trim() : "";
  if (!BVID_RE.test(bvid)) return null;

  return {
    bvid,
    title: typeof item.title === "string" ? item.title.trim() : undefined,
    author: typeof item.author === "string" ? item.author.trim() : undefined,
    url:
      typeof item.url === "string" && item.url.trim()
        ? item.url.trim()
        : `https://www.bilibili.com/video/${bvid}`,
  };
}

function sanitizeFileStem(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[\[\]{}()（）【】「」『』]/g, "")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim();

  return (cleaned || "bili_audio").slice(0, 160);
}

function targetFilename(video: DownloadVideo, extension: string) {
  const title = sanitizeFileStem(video.title || video.bvid);
  const author = video.author ? sanitizeFileStem(video.author) : "";
  const stem = author ? `${title}_${author}` : title;
  return `${stem}_${video.bvid}${extension}`;
}

async function listAudioEntries(dirPath: string): Promise<AudioEntry[]> {
  const files = await readdir(dirPath, { withFileTypes: true });
  const entries = await Promise.all(
    files
      .filter((file) => !file.isDirectory() && isSupportedAudioFile(file.name))
      .map(async (file) => {
        const fileStat = await stat(path.join(/* turbopackIgnore: true */ dirPath, file.name));
        return { name: file.name, mtimeMs: fileStat.mtimeMs };
      })
  );

  return entries.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
}

async function uniqueTargetPath(dirPath: string, filename: string) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, -extension.length);
  let candidate = filename;
  let index = 2;

  while (true) {
    try {
      await stat(path.join(/* turbopackIgnore: true */ dirPath, candidate));
      candidate = `${stem}_${index}${extension}`;
      index += 1;
    } catch {
      return path.join(/* turbopackIgnore: true */ dirPath, candidate);
    }
  }
}

function bv2mp3Args(videos: DownloadVideo[], npmCacheDir: string) {
  return [
    "--yes",
    "--cache",
    npmCacheDir,
    "--prefer-offline",
    "bv2mp3",
    ...videos.map((video) => `--url=https://www.bilibili.com/video/${video.bvid}`),
  ];
}

async function runBv2Mp3(targetDir: string, videos: DownloadVideo[]) {
  const npmCacheDir = path.join(/* turbopackIgnore: true */ process.cwd(), ".npm-cache");
  await mkdir(npmCacheDir, { recursive: true });

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : npxCommand;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", npxCommand, ...bv2mp3Args(videos, npmCacheDir)]
    : bv2mp3Args(videos, npmCacheDir);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const nodeBinDir = process.execPath.replace(/[\\/][^\\/]+$/, "");
  const env = {
    ...process.env,
    npm_config_cache: npmCacheDir,
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_loglevel: "warn",
    ...(process.platform === "win32"
      ? { [pathKey]: `${nodeBinDir}${path.delimiter}${process.env[pathKey] ?? ""}` }
      : {}),
  };

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: targetDir,
      env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) =>
      (current + chunk.toString("utf8")).slice(-12_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`bv2mp3 exited with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function renameDownloadedFiles(
  dirPath: string,
  newEntries: AudioEntry[],
  videos: DownloadVideo[]
) {
  const renamed: string[] = [];

  for (let i = 0; i < newEntries.length; i += 1) {
    const entry = newEntries[i];
    const video = videos[i] ?? videos[videos.length - 1];
    if (!entry || !video) continue;

    const extension = path.extname(entry.name).toLowerCase() || ".mp3";
    const targetName = targetFilename(video, extension);
    if (entry.name === targetName) {
      renamed.push(entry.name);
      continue;
    }

    const from = path.join(/* turbopackIgnore: true */ dirPath, entry.name);
    const to = await uniqueTargetPath(dirPath, targetName);
    await rename(from, to);
    renamed.push(path.basename(to));
  }

  return renamed;
}

function tracksForVideos(tracks: Track[], videos: DownloadVideo[], renamedNames: string[]) {
  const bvids = new Set(videos.map((video) => video.bvid));
  const names = new Set(renamedNames);
  return tracks.filter((track) => {
    if (track.bvid && bvids.has(track.bvid)) return true;
    return names.has(track.filename);
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const input = body && typeof body === "object" ? (body as { videos?: unknown[] }) : {};
  const rawVideos = Array.isArray(input.videos) ? input.videos : [];
  const videos = rawVideos.map(normalizeVideo).filter((item): item is DownloadVideo => Boolean(item));

  if (!videos.length) {
    return Response.json({ error: "videos must include at least one valid bvid" }, { status: 400 });
  }
  if (videos.length > MAX_BATCH_SIZE) {
    return Response.json({ error: `batch size must be <= ${MAX_BATCH_SIZE}` }, { status: 400 });
  }

  const subDir = todaySubDir();
  const dirPath = path.join(/* turbopackIgnore: true */ MUSIC_DIR, subDir);
  await mkdir(dirPath, { recursive: true });

  const before = new Set((await listAudioEntries(dirPath)).map((entry) => entry.name));

  try {
    const logs = await runBv2Mp3(dirPath, videos);
    const after = await listAudioEntries(dirPath);
    const newEntries = after.filter((entry) => !before.has(entry.name));
    const renamedNames = await renameDownloadedFiles(dirPath, newEntries, videos);

    clearTrackCache();
    const scannedTracks = await scanTrackDirectory(subDir);
    const tracks = tracksForVideos(scannedTracks, videos, renamedNames);

    return Response.json({
      subDir,
      count: tracks.length,
      tracks,
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: message,
        hint: "请确认当前环境可运行 npx bv2mp3，并且 B 站网络可访问。",
        tracks: [],
      },
      { status: 502 }
    );
  }
}
