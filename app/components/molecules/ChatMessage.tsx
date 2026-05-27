"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { Track } from "@/app/lib/types";
import type { ChatMessage as ChatMessageModel } from "@/app/lib/types";
import { usePlayer } from "@/app/context/PlayerContext";
import { useAgent } from "@/app/context/AgentContext";
import { useDanmaku } from "@/app/context/DanmakuContext";

type Props = { message: ChatMessageModel };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tracks"; tracks: Track[] }
  | { type: "added"; tracks: Track[] }
  | { type: "web"; results: WebResult[] };

const FENCED_RE = /```(tracks|json|added|web)?\s*\n([\s\S]*?)```/g;

type WebResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
};

function looksLikeTracks(arr: unknown[]): arr is Track[] {
  if (arr.length === 0) return false;
  const first = arr[0] as Record<string, unknown>;
  return typeof first === "object" && first !== null && "title" in first;
}

function tryParseTrackArray(raw: string): Track[] | null {
  try {
    const trimmed = raw.trim();
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && looksLikeTracks(parsed)) return parsed;
    if (parsed?.tracks && Array.isArray(parsed.tracks) && looksLikeTracks(parsed.tracks))
      return parsed.tracks;
  } catch { /* not valid JSON */ }
  return tryExtractTracksFromRaw(raw);
}

function looksLikeWebResults(arr: unknown[]): arr is WebResult[] {
  if (arr.length === 0) return false;
  const first = arr[0] as Record<string, unknown>;
  return (
    typeof first === "object" &&
    first !== null &&
    typeof first.title === "string" &&
    typeof first.url === "string"
  );
}

function tryParseWebResults(raw: string): WebResult[] | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed) && looksLikeWebResults(parsed)) return parsed;
    if (parsed?.results && Array.isArray(parsed.results) && looksLikeWebResults(parsed.results)) {
      return parsed.results;
    }
  } catch {
    // not valid JSON
  }
  return null;
}

const OBJ_RE = /\{([^}]*)\}/g;

function tryExtractTracksFromRaw(raw: string): Track[] | null {
  const tracks: Track[] = [];
  OBJ_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OBJ_RE.exec(raw)) !== null) {
    const obj = m[1];
    const bvid = obj.match(/"bvid"\s*:\s*"([^"]+)"/)?.[1];
    const id = obj.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
    const title = obj.match(/"title"\s*:\s*"([\s\S]+?)"\s*,\s*"(?:author|duration|url|bvid|id)"/)?.[1];
    const author = obj.match(/"author"\s*:\s*"([\s\S]+?)"\s*,\s*"(?:duration|url|bvid)"/)?.[1];
    const duration = obj.match(/"duration"\s*:\s*"([^"]+)"/)?.[1];
    const url = obj.match(/"url"\s*:\s*"([^"]+)"/)?.[1];

    const trackId = bvid || id;
    if (trackId && title) {
      tracks.push({
        id: trackId,
        ...(bvid ? { bvid } : {}),
        title,
        author: author ?? "",
        ...(duration ? { duration } : {}),
        url: url ?? "",
        date: "",
        filename: "",
        subDir: "",
        size: 0,
      } as Track);
    }
  }
  OBJ_RE.lastIndex = 0;
  return tracks.length > 0 ? tracks : null;
}

function parseContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let last = 0;

  FENCED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCED_RE.exec(content)) !== null) {
    const tag = match[1] || "tracks";
    const body = match[2] ?? "";
    const tracks = tag === "web" ? null : tryParseTrackArray(body);
    const webResults = tag === "web" ? tryParseWebResults(body) : null;
    if (match.index > last) {
      parts.push({ type: "text", text: content.slice(last, match.index) });
    }
    if (webResults) {
      parts.push({ type: "web", results: webResults });
    } else if (tracks) {
      parts.push({ type: tag === "added" ? "added" : "tracks", tracks });
    } else {
      // fenced block found but JSON parsing failed — render the captured content as text
      parts.push({ type: "text", text: body });
    }
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    const remainder = content.slice(last);
    const bare = remainder.match(/(\[[\s\n]*\{[\s\S]*?\}[\s\n]*\])/);
    if (bare) {
      const tracks = tryParseTrackArray(bare[1]);
      if (tracks) {
        const idx = remainder.indexOf(bare[1]);
        if (idx > 0) parts.push({ type: "text", text: remainder.slice(0, idx) });
        parts.push({ type: "tracks", tracks });
        const end = idx + bare[1].length;
        if (end < remainder.length) parts.push({ type: "text", text: remainder.slice(end) });
        return parts;
      }
    }
    parts.push({ type: "text", text: remainder });
  }
  return parts;
}

type TrackExt = Track & { bvid?: string; neteaseId?: string; duration?: string };

function trackKey(track: TrackExt, index = 0) {
  return (
    track.id ||
    track.bvid ||
    track.neteaseId ||
    track.url ||
    `${track.title || "track"}-${index}`
  );
}

function inferNeteaseId(track: TrackExt) {
  return (
    track.neteaseId ||
    (typeof track.id === "string" ? track.id.match(/^netease\/(\d+)$/)?.[1] : undefined) ||
    (typeof track.url === "string" ? track.url.match(/\/api\/netease\/audio\/(\d+)/)?.[1] : undefined)
  );
}

function normalizeTrackForCard(track: TrackExt, index = 0): TrackExt {
  const neteaseId = inferNeteaseId(track);
  const id = track.id || (track.bvid ? track.bvid : neteaseId ? `netease/${neteaseId}` : track.url || `track-${index}`);
  return {
    ...track,
    id,
    ...(neteaseId ? { neteaseId } : {}),
    title: track.title || id,
    author: track.author || "",
    date: track.date || "",
    filename: track.filename || "",
    subDir: track.subDir || "",
    size: track.size || 0,
    url: track.url || (neteaseId ? `/api/netease/audio/${neteaseId}` : ""),
  };
}

function AddedCards({ tracks }: { tracks: TrackExt[] }) {
  const { addTracks } = usePlayer();
  const didAutoAdd = useRef(false);

  useEffect(() => {
    if (!didAutoAdd.current && tracks.length > 0) {
      didAutoAdd.current = true;
      addTracks(tracks);
    }
  }, [tracks, addTracks]);

  return (
    <div
      className="my-2 overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--color-outline-variant)" }}
    >
      <div
        className="px-3 py-2"
        style={{ backgroundColor: "var(--color-surface-container)" }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ fontFamily: "var(--font-headline)", color: "var(--color-primary)" }}
        >
          [{tracks.length} TRACKS ADDED]
        </span>
      </div>
      <div className="max-h-[16rem] overflow-y-auto scrollbar-thin">
        {tracks.map((raw, i) => {
          const t = normalizeTrackForCard(raw, i);
          return (
          <div
            key={trackKey(t, i)}
            className="flex items-center gap-2 border-t px-3 py-2"
            style={{ borderColor: "var(--color-outline-variant)" }}
          >
            <div className="min-w-0 flex-1">
              <p
                className="m-0 truncate text-sm"
                style={{ fontFamily: "var(--font-body)", color: "var(--color-on-surface)" }}
              >
                {t.title}
              </p>
              <p className="m-0 truncate text-xs opacity-60" style={{ fontFamily: "var(--font-body)" }}>
                {t.author}
                {t.duration && <span className="ml-2 opacity-70">{t.duration}</span>}
              </p>
            </div>
            <span
              className="shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-50"
              style={{
                fontFamily: "var(--font-headline)",
                borderColor: "var(--color-outline-variant)",
                color: "var(--color-outline)",
              }}
            >
              ADDED
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function WebResultCards({ results }: { results: WebResult[] }) {
  return (
    <div
      className="my-2 overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--color-outline-variant)" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ backgroundColor: "var(--color-surface-container)" }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ fontFamily: "var(--font-headline)", color: "var(--color-primary)" }}
        >
          [{results.length} WEB_RESULTS]
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-60"
          style={{ fontFamily: "var(--font-headline)", color: "var(--color-outline)" }}
        >
          OPEN_WEB
        </span>
      </div>
      <div className="max-h-[16rem] overflow-y-auto scrollbar-thin">
        {results.map((item, index) => (
          <a
            key={`${item.url}-${index}`}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border-t px-3 py-2 transition-colors hover:bg-[color:var(--color-surface-container)]"
            style={{ borderColor: "var(--color-outline-variant)" }}
          >
            <p
              className="m-0 truncate text-sm font-semibold"
              style={{ fontFamily: "var(--font-body)", color: "var(--color-primary)" }}
              title={item.title}
            >
              {item.title}
            </p>
            {item.snippet && (
              <p
                className="m-0 mt-1 line-clamp-2 text-xs leading-relaxed opacity-72"
                style={{ fontFamily: "var(--font-body)", color: "var(--color-on-surface)" }}
              >
                {item.snippet}
              </p>
            )}
            <p className="m-0 mt-1 truncate text-[11px] opacity-55" style={{ fontFamily: "var(--font-body)" }}>
              {item.source || item.url}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

type ButtonState = "add" | "queued" | "converting" | "added";

function getButtonState(
  track: TrackExt,
  inPlaylist: Set<string>,
  convertQueue: string[],
  convertingSet: Set<string>,
  convertedSet: Set<string>
): ButtonState {
  const id = track.id || track.bvid || track.neteaseId || track.url;
  if ((id && inPlaylist.has(id)) || (track.bvid && inPlaylist.has(track.bvid))) return "added";
  if (track.bvid) {
    if (convertedSet.has(track.bvid)) return "added";
    if (convertingSet.has(track.bvid)) return "converting";
    if (convertQueue.includes(track.bvid)) return "queued";
  }
  return "add";
}

const BTN_CONFIG: Record<ButtonState, { label: string; disabled: boolean }> = {
  add: { label: "+ ADD", disabled: false },
  queued: { label: "QUEUED", disabled: true },
  converting: { label: "CONVERTING...", disabled: true },
  added: { label: "ADDED", disabled: true },
};

function TrackCards({ tracks }: { tracks: TrackExt[] }) {
  const { state, addTracks } = usePlayer();
  const { queueConvert, convertQueue, convertingSet, convertedSet } = useAgent();
  const { fetchDanmaku } = useDanmaku();
  const inPlaylist = new Set(state.playlist.map((t) => t.id));

  const isCloud = tracks.some((t) => t.bvid);

  const normalizedTracks = tracks.map(normalizeTrackForCard);

  const allDone = normalizedTracks.every((t) => {
    const s = getButtonState(t, inPlaylist, convertQueue, convertingSet, convertedSet);
    return s !== "add";
  });

  const handleAdd = (track: TrackExt) => {
    if (track.bvid) {
      queueConvert([track]);
      fetchDanmaku(track.bvid);
    } else {
      addTracks([track]);
    }
  };

  const handleAddAll = () => {
    if (isCloud) {
      const cloudTracks = normalizedTracks
        .filter((t) => t.bvid && getButtonState(t, inPlaylist, convertQueue, convertingSet, convertedSet) === "add")
        .map((t) => t);
      if (cloudTracks.length) {
        queueConvert(cloudTracks);
        cloudTracks.forEach((track) => {
          if (track.bvid) fetchDanmaku(track.bvid);
        });
      }
    } else {
      addTracks(normalizedTracks);
    }
  };

  return (
    <div
      className="my-2 overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--color-outline-variant)" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ backgroundColor: "var(--color-surface-container)" }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ fontFamily: "var(--font-headline)", color: "var(--color-outline)" }}
        >
          [{tracks.length} TRACKS]
        </span>
        <button
          onClick={handleAddAll}
          disabled={allDone}
          className="rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-opacity disabled:opacity-40"
          style={{
            fontFamily: "var(--font-headline)",
            borderColor: "var(--color-primary)",
            color: "var(--color-primary)",
          }}
        >
          {allDone ? "ALL_ADDED" : "ADD_ALL"}
        </button>
      </div>
      <div className="max-h-[16rem] overflow-y-auto scrollbar-thin">
        {normalizedTracks.map((t, index) => {
          const neteaseId = inferNeteaseId(t);
          const btnState = getButtonState(t, inPlaylist, convertQueue, convertingSet, convertedSet);
          const cfg = BTN_CONFIG[btnState];
          return (
            <div
              key={trackKey(t, index)}
              className="flex items-center gap-2 border-t px-3 py-2"
              style={{ borderColor: "var(--color-outline-variant)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm" style={{ fontFamily: "var(--font-body)" }}>
                  {t.bvid ? (
                    <a
                      href={`https://www.bilibili.com/video/${t.bvid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:underline"
                      style={{ color: "var(--color-primary)" }}
                      title={t.title}
                    >
                      {t.title}
                    </a>
                  ) : neteaseId ? (
                    <a
                      href={`https://music.163.com/#/song?id=${neteaseId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors hover:underline"
                      style={{ color: "var(--color-primary)" }}
                      title={t.title}
                    >
                      {t.title}
                    </a>
                  ) : (
                    <span style={{ color: "var(--color-on-surface)" }}>{t.title}</span>
                  )}
                </p>
                <p className="m-0 truncate text-xs opacity-60" style={{ fontFamily: "var(--font-body)" }}>
                  {t.author}
                  {t.source && <span className="ml-2 opacity-70">{t.source.toUpperCase()}</span>}
                  {t.duration && <span className="ml-2 opacity-70">{t.duration}</span>}
                </p>
              </div>
              <button
                onClick={() => handleAdd(t)}
                disabled={cfg.disabled}
                className="shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-opacity disabled:opacity-40"
                style={{
                  fontFamily: "var(--font-headline)",
                  borderColor: cfg.disabled ? "var(--color-outline-variant)" : "var(--color-primary)",
                  color: cfg.disabled ? "var(--color-outline)" : "var(--color-primary)",
                }}
              >
                {cfg.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelFor(role: ChatMessageModel["role"]) {
  if (role === "agent") return "AGENT_01";
  if (role === "operator") return "OPERATOR";
  if (role === "tool") return "TOOL";
  return "SYS";
}

function formatTs(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(ts);
  } catch {
    return String(ts);
  }
}

function ToolMessage({ message: m }: Props) {
  const [open, setOpen] = useState(false);
  const firstLine = m.content.split("\n")[0] ?? "";
  const rest = m.content.slice(firstLine.length + 1);
  const toolLabel = m.toolName || firstLine.split(/\s/)[0] || "Tool";

  return (
    <article className="mb-1 flex w-full justify-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[min(100%,38rem)] cursor-pointer items-start gap-1.5 border-l-[3px] border-transparent py-1 pl-4 pr-4 text-left transition-opacity hover:opacity-90"
        style={{
          borderLeftColor: "var(--color-secondary)",
          opacity: open ? 0.8 : 0.5,
        }}
      >
        <span
          className="mt-px shrink-0 text-[10px]"
          style={{ color: "var(--color-outline)" }}
        >
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline min-w-0">
            <span
              className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ fontFamily: "var(--font-headline)", color: "var(--color-secondary)" }}
            >
              [{toolLabel}]
            </span>
            {!open && rest && (
              <span
                className="ml-1.5 truncate text-[11px]"
                style={{ fontFamily: "var(--font-body)", color: "var(--color-outline)" }}
              >
                {rest.slice(0, 80)}
              </span>
            )}
          </div>
          {open && rest && (
            <pre
              className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed"
              style={{ fontFamily: "var(--font-body)", color: "var(--color-outline)" }}
            >
              {rest}
            </pre>
          )}
        </div>
      </button>
    </article>
  );
}

export function ChatMessage({ message: m }: Props) {
  if (m.role === "tool") return <ToolMessage message={m} />;

  const isOp = m.role === "operator";
  const label = labelFor(m.role);

  const bgAgent = m.role === "agent";

  const edge =
    m.role === "system"
      ? "var(--color-error)"
      : "var(--color-outline-variant)";

  const borderStyle: CSSProperties = isOp
    ? { borderRightColor: edge }
    : { borderLeftColor: edge };

  const parts = m.role === "agent" ? parseContent(m.content) : null;

  return (
    <article className={`mb-6 flex w-full ${isOp ? "justify-end" : "justify-start"}`}>
      <div
        className={
          `max-w-[min(100%,38rem)] pl-4 pr-4 pt-3 pb-3 ` +
          (isOp ? "border-r-[3px] border-transparent border-l-transparent" : "border-l-[3px] border-transparent border-r-transparent") +
          ` ` +
          (bgAgent ? "bg-[color:var(--color-surface-container-high)]" : "")
        }
        style={borderStyle}
      >
        <div
          className={`mb-3 flex flex-wrap items-baseline gap-2 opacity-92 ${isOp ? "justify-end" : ""}`}
        >
          <span
            className="terminal-label"
            style={{ fontFamily: "var(--font-headline)", letterSpacing: "var(--tracking-label)" }}
          >
            {label}
          </span>
          <span className="text-[11px] text-[color:var(--color-outline)]">{formatTs(m.timestamp)}</span>
        </div>
        {parts ? (
          <div className={isOp ? "text-right" : "text-left"}>
            {parts.map((part, i) => {
              if (part.type === "added") return <AddedCards key={i} tracks={part.tracks} />;
              if (part.type === "tracks") return <TrackCards key={i} tracks={part.tracks} />;
              if (part.type === "web") return <WebResultCards key={i} results={part.results} />;
              return (
                <pre
                  key={i}
                  className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed"
                  style={{ fontFamily: "var(--font-body)", color: "var(--color-on-surface)" }}
                >
                  {part.text}
                </pre>
              );
            })}
          </div>
        ) : (
          <pre
            className={`m-0 whitespace-pre-wrap break-words text-sm leading-relaxed ${isOp ? "text-right" : "text-left"}`}
            style={{ fontFamily: "var(--font-body)", color: "var(--color-on-surface)" }}
          >
            {m.content}
          </pre>
        )}
      </div>
    </article>
  );
}
