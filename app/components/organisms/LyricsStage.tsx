"use client";

import { GlowDot } from "@/app/components/atoms/GlowDot";
import { Label } from "@/app/components/atoms/Label";
import { usePlayer } from "@/app/context/PlayerContext";
import type { Track } from "@/app/lib/types";
import { useEffect, useMemo, useState } from "react";

type LyricLine = {
  time: number;
  text: string;
};

const BAR_COUNT = 28;
const EMPTY_LRC_LINES: LyricLine[] = [];

function buildFallbackLines(track: Track | null, expectedLyricName: string | null): string[] {
  if (!track) {
    return [
      "等待音轨接入",
      "频谱正在校准",
      "歌词将在播放时点亮",
      "把想听的歌交给右侧智能体",
    ];
  }

  const title = track.title || "未知曲目";
  const author = track.author || "未知来源";
  if (expectedLyricName) {
    return [
      title,
      "未找到歌词文件",
      `请放入同名歌词：${expectedLyricName}`,
      "支持 .lrc/.krc 时间轴歌词，也支持 .txt 普通歌词",
    ];
  }

  return [
    title,
    `${author} / ${track.format?.toUpperCase() || "AUDIO"}`,
    "电流穿过节拍",
    "弹幕和旋律一起漂移",
    "把这一段留在播放队列里",
    "下一拍继续发光",
  ];
}

function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const plainLines: string[] = [];
  for (const row of raw.split(/\r?\n/)) {
    const text = row.replace(/\[[^\]]+\]/g, "").trim();
    const matches = row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g);
    let matched = false;
    for (const match of matches) {
      matched = true;
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0").slice(0, 3));
      if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
      lines.push({ time: min * 60 + sec + fraction / 1000, text });
    }
    if (!matched && text && !/^\[(ar|ti|al|by|offset):/i.test(row.trim())) {
      plainLines.push(text);
    }
  }

  const timed = lines
    .filter((line) => line.text)
    .sort((a, b) => a.time - b.time);
  if (timed.length) return timed;

  return plainLines.map((text, index) => ({ time: index * 4, text }));
}

function trackLocation(track: Track) {
  const subDir = track.subDir || (track.id?.includes("/") ? track.id.split("/")[0] : "");
  let filename = track.filename || (track.id?.includes("/") ? track.id.split("/").slice(1).join("/") : "");

  if (!filename && track.url?.includes("/api/tracks/")) {
    const encoded = track.url.split("/api/tracks/")[1]?.split("?")[0] ?? "";
    const parts = encoded.split("/").map((part) => decodeURIComponent(part));
    filename = parts.slice(1).join("/");
    return parts[0] && filename ? { subDir: parts[0], filename } : null;
  }

  return subDir && filename ? { subDir, filename } : null;
}

function lyricUrlFor(track: Track) {
  const neteaseId = track.neteaseId || track.id.match(/^netease\/(\d+)$/)?.[1];
  if (neteaseId) return `/api/netease/lyric/${encodeURIComponent(neteaseId)}`;

  const location = trackLocation(track);
  if (!location) return null;

  const filename = location.filename.replace(/\.[^.]+$/, ".lrc");
  return `/api/lyrics/${encodeURIComponent(location.subDir)}/${encodeURIComponent(filename)}`;
}

function expectedLyricNameFor(track: Track | null) {
  if (!track) return null;
  if (track.neteaseId || /^netease\/\d+$/.test(track.id)) return null;
  const location = trackLocation(track);
  return location ? location.filename.replace(/\.[^.]+$/, ".lrc") : null;
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function activeLyricIndex(lines: LyricLine[], progress: number) {
  let active = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.time > progress) break;
    active = i;
  }
  return active;
}

export function LyricsStage() {
  const { state } = usePlayer();
  const track = state.current;
  const [lrcState, setLrcState] = useState<{ trackId: string; lines: LyricLine[] } | null>(null);

  useEffect(() => {
    if (!track) return;

    const controller = new AbortController();
    const trackId = track.id;
    const lyricUrl = lyricUrlFor(track);
    if (!lyricUrl) {
      setTimeout(() => {
        if (!controller.signal.aborted) setLrcState({ trackId, lines: [] });
      }, 0);
      return () => controller.abort();
    }

    fetch(lyricUrl, { signal: controller.signal })
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!controller.signal.aborted) setLrcState({ trackId, lines: text ? parseLrc(text) : [] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLrcState({ trackId, lines: [] });
      });

    return () => controller.abort();
  }, [track]);

  const lrcLines = useMemo(
    () => (track && lrcState?.trackId === track.id ? lrcState.lines : EMPTY_LRC_LINES),
    [track, lrcState]
  );
  const expectedLyricName = useMemo(() => expectedLyricNameFor(track), [track]);
  const fallbackLines = useMemo(() => buildFallbackLines(track, expectedLyricName), [track, expectedLyricName]);
  const lines = useMemo<LyricLine[]>(
    () => lrcLines.length ? lrcLines : fallbackLines.map((text, index) => ({ time: index * 4, text })),
    [fallbackLines, lrcLines]
  );
  const activeIndex = lrcLines.length
    ? activeLyricIndex(lines, state.progress)
    : state.duration > 0
      ? Math.min(lines.length - 1, Math.floor((state.progress / state.duration) * lines.length))
      : Math.floor(state.progress / 4) % lines.length;
  const windowStart = Math.max(0, Math.min(activeIndex - 2, Math.max(lines.length - 5, 0)));
  const visibleLines = lines.slice(windowStart, windowStart + 5);
  const progress = state.duration > 0 ? Math.min(100, (state.progress / state.duration) * 100) : 0;

  return (
    <section
      className="relative h-[17rem] shrink-0 overflow-hidden rounded-sm border"
      style={{
        borderColor: "var(--color-surface-container-high)",
        backgroundColor: "color-mix(in srgb, var(--color-surface-container-low) 92%, transparent)",
      }}
      aria-label="Lyrics and live effects"
    >
      <style>{`
        @keyframes lyric-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes lyric-meter {
          0%, 100% { transform: scaleY(0.38); opacity: 0.5; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        @keyframes lyric-scan {
          from { transform: translateY(-100%); opacity: 0; }
          20%, 70% { opacity: 0.12; }
          to { transform: translateY(100%); opacity: 0; }
        }
        @keyframes lyric-pulse {
          0%, 100% { box-shadow: 0 0 16px rgba(111, 238, 225, 0.16); }
          50% { box-shadow: 0 0 34px rgba(111, 238, 225, 0.34); }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-20"
        style={{
          background: "linear-gradient(to bottom, color-mix(in srgb, var(--color-primary) 12%, transparent), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, color-mix(in srgb, var(--color-on-surface) 5%, transparent) 1px, transparent 1px)",
          backgroundSize: "100% 18px",
          opacity: 0.42,
        }}
      />
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-60 w-60 rounded-full border"
        style={{
          borderColor: "color-mix(in srgb, var(--color-primary) 38%, transparent)",
          animation: "lyric-orbit 16s linear infinite",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ animation: "lyric-scan 5.2s linear infinite" }}>
        <div className="h-full" style={{ background: "linear-gradient(to bottom, transparent, var(--color-primary), transparent)" }} />
      </div>

      <header
        className="relative z-10 flex items-center gap-3 border-b px-3 py-2.5 md:px-4"
        style={{ borderColor: "var(--color-outline-variant)" }}
      >
        <GlowDot color="primary" className={state.playing ? "" : "opacity-45"} />
        <Label size="md" className="text-[color:var(--color-on-surface)]">
          LYRIC_STAGE
        </Label>
        <span
          className="ml-auto text-[10px] font-semibold uppercase tabular-nums"
          style={{
            color: "var(--color-outline)",
            fontFamily: "var(--font-headline)",
            letterSpacing: "0.16em",
          }}
        >
          {formatClock(state.progress)} / {formatClock(state.duration)}
        </span>
      </header>

      <div className="relative z-10 grid h-[calc(100%-2.65rem)] grid-rows-[1fr_auto] gap-3 px-4 py-3">
        <div className="grid content-center gap-2">
          {visibleLines.map((line, index) => {
            const globalIndex = windowStart + index;
            const active = globalIndex === activeIndex;
            return (
              <p
                key={`${line.time}-${line.text}-${globalIndex}`}
                className="m-0 truncate text-center font-semibold transition-all duration-300"
                style={{
                  color: active ? "var(--color-primary)" : "var(--color-outline)",
                  fontFamily: active ? "var(--font-headline)" : "var(--font-body)",
                  fontSize: active ? "1rem" : "0.78rem",
                  opacity: active ? 1 : 0.55,
                  letterSpacing: active ? "0.1em" : "0",
                  textShadow: active ? "0 0 16px var(--color-crt-glow-soft)" : "none",
                }}
              >
                {line.text}
              </p>
            );
          })}
        </div>

        <div className="grid gap-2">
          <div className="flex h-12 items-end gap-1" aria-hidden>
            {Array.from({ length: BAR_COUNT }).map((_, index) => {
              const height = state.playing ? 28 + ((index * 11 + activeIndex * 7) % 44) : 12 + ((index * 5) % 20);
              return (
                <span
                  key={index}
                  className="flex-1 rounded-sm"
                  style={{
                    height: `${height}%`,
                    minWidth: 2,
                    backgroundColor: index % 5 === activeIndex % 5 ? "var(--color-primary)" : "var(--color-secondary)",
                    opacity: state.playing ? 0.9 : 0.34,
                    transformOrigin: "bottom",
                    animation: state.playing ? `lyric-meter ${0.72 + (index % 5) * 0.12}s ease-in-out ${index * 0.03}s infinite` : "none",
                  }}
                />
              );
            })}
          </div>
          <div className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--color-surface-container-high)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(to right, var(--color-primary-dim), var(--color-primary))",
                animation: state.playing ? "lyric-pulse 1.8s ease-in-out infinite" : "none",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
