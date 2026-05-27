"use client";

import type { AgentState, ChatMessage, Track } from "@/app/lib/types";
import { useMode } from "@/app/context/ModeContext";
import { useSSE } from "@/app/hooks/useSSE";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type DownloadCandidate = Pick<Track, "bvid" | "title" | "author" | "url"> & {
  bvid: string;
};

type WebResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
};

type WebSearchResponse = {
  query?: string;
  total?: number;
  results?: WebResult[];
  tracks?: Track[];
  songs?: Array<{
    id: string;
    title: string;
    author: string;
    album?: string;
    duration?: string;
    url: string;
  }>;
  videos?: Array<{
    bvid: string;
    title: string;
    author: string;
    duration?: string;
    url?: string;
  }>;
  errors?: string[];
};

type AgentCtxValue = AgentState & {
  sendMessage: (text: string) => Promise<void>;
  queueConvert: (items: Array<string | Pick<Track, "bvid" | "title" | "author" | "url">>) => void;
  cancel: () => void;
  convertQueue: string[];
  convertingSet: Set<string>;
  convertedSet: Set<string>;
};

const AgentContext = createContext<AgentCtxValue | null>(null);

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function appendFromSdkPayload(
  data: unknown,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
) {
  if (!data || typeof data !== "object") return;
  const d = data as Record<string, unknown>;

  const sid = d.session_id;
  if (typeof sid === "string" && sid) {
    setSessionId((prev) => prev ?? sid);
  }

  const t = d.type;
  const ts = Date.now();

  if (t === "assistant") {
    const message = d.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;
    const blocks = content as Array<Record<string, unknown>>;
    for (const block of blocks) {
      if (block.type === "text") {
        const text = block.text;
        if (typeof text === "string" && text.trim()) {
          setMessages((m) => [
            ...m,
            { id: newId(), role: "agent" as const, content: text, timestamp: ts },
          ]);
        }
      } else if (block.type === "tool_use") {
        const tool = block.name;
        if (typeof tool === "string") {
          let summary = `Tool: ${tool}`;
          if (block.input !== undefined) {
            try {
              summary += `\n${JSON.stringify(block.input).slice(0, 480)}`;
            } catch {
              summary += "\n[input]";
            }
          }
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "tool" as const,
              content: summary,
              timestamp: ts,
              toolName: tool,
            },
          ]);
        }
      }
    }
    return;
  }

  if (t === "tool_call") {
    const name =
      (typeof d.name === "string" && d.name) ||
      (typeof d.tool === "string" && d.tool) ||
      "tool";
    let body =
      typeof d.arguments === "string"
        ? d.arguments
        : d.input !== undefined
          ? JSON.stringify(d.input)
          : "";
    if (!body.trim()) body = "{}";
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "tool" as const,
        content: `${name}\n${body.slice(0, 512)}`,
        timestamp: ts,
        toolName: name,
      },
    ]);
    return;
  }

  if (t === "result" && d.subtype === "success" && typeof d.result === "string") {
    const text = d.result.trim();
    if (text.length) {
      setMessages((m) => {
        const lastAgent = [...m].reverse().find((msg) => msg.role === "agent");
        if (lastAgent && lastAgent.content === text) return m;
        return [
          ...m,
          { id: newId(), role: "agent" as const, content: text, timestamp: ts },
        ];
      });
    }
  }
}

function normalizeDownloadItems(
  items: Array<string | Pick<Track, "bvid" | "title" | "author" | "url">>
): DownloadCandidate[] {
  const normalized: DownloadCandidate[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      const bvid = item.trim();
      if (bvid) normalized.push({ bvid, title: bvid, author: "", url: "" });
      continue;
    }

    const bvid = item.bvid?.trim();
    if (!bvid) continue;
    normalized.push({
      bvid,
      title: item.title || bvid,
      author: item.author || "",
      url: item.url || `https://www.bilibili.com/video/${bvid}`,
    });
  }

  return normalized;
}

function shouldUseDirectWebSearch(text: string, mode: string) {
  const explicitWeb = /全网|网页|互联网|网上|资料|链接/.test(text);
  const cloudSearch = mode === "cloud" && /搜索|搜一下|查一下|找一下|推荐|播放|听|下载|加入曲库/.test(text);
  return explicitWeb || cloudSearch;
}

function extractSearchQuery(text: string) {
  return text
    .replace(/^(请|帮我|麻烦你|给我|我要|想要|我想)?/u, "")
    .replace(/(全网|网页|互联网|网上)?(搜索|搜一下|查一下|找一下|推荐|播放|听听|听|下载|加入曲库)/gu, " ")
    .replace(/(的)?(资源|资料|链接|音乐|歌曲|视频|音频)$/u, "")
    .replace(/[，。！？!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || text.trim();
}

function formatDirectSearchMessage(json: WebSearchResponse) {
  const results = Array.isArray(json.results) ? json.results.slice(0, 6) : [];
  const tracks = Array.isArray(json.tracks) ? json.tracks.slice(0, 8) : [];
  const videos = Array.isArray(json.videos) ? json.videos.slice(0, 8) : [];
  const intro = `已完成全网搜索：${json.query || "关键词"}\n网页 ${results.length} 条，网易云 ${tracks.length} 首，B 站候选 ${videos.length} 条。`;

  const blocks: string[] = [intro];
  if (results.length) {
    blocks.push(`\`\`\`web\n${JSON.stringify(results, null, 2)}\n\`\`\``);
  }
  if (tracks.length || videos.length) {
    const biliTracks = videos.map((video) => ({
      bvid: video.bvid,
      title: video.title,
      author: video.author,
      duration: video.duration ?? "",
      url: video.url || `https://www.bilibili.com/video/${video.bvid}`,
    }));
    const mergedTracks = [...tracks, ...biliTracks];
    blocks.push(`\`\`\`tracks\n${JSON.stringify(mergedTracks, null, 2)}\n\`\`\``);
  }
  if (!results.length && !tracks.length && !videos.length) {
    blocks.push("没有搜到可用结果，可以换一个关键词再试。");
  }
  return blocks.join("\n\n");
}

export function AgentProvider({
  children,
  chatApiPath = "/api/chat",
}: {
  children: ReactNode;
  chatApiPath?: string;
}) {
  const { mode } = useMode();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [convertQueue, setConvertQueue] = useState<string[]>([]);
  const [convertingSet, setConvertingSet] = useState<Set<string>>(new Set());
  const [convertedSet, setConvertedSet] = useState<Set<string>>(new Set());

  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const convertQueueRef = useRef<string[]>([]);
  const downloadItemsRef = useRef(new Map<string, DownloadCandidate>());
  const downloadingRef = useRef(false);

  const { send, loading, cancel: sseCancel } = useSSE({
    url: chatApiPath,
    body: { mode },
    onMessage: (msg) => {
      if (msg.event === "output") {
        appendFromSdkPayload(msg.data, setMessages, setSessionId);
        return;
      }
      if (msg.event === "error") {
        const err =
          typeof msg.data === "string"
            ? msg.data
            : JSON.stringify(msg.data ?? "error");
        setMessages((m) => [
          ...m,
          { id: newId(), role: "system", content: err, timestamp: Date.now() },
        ]);
      }
    },
  });

  const flushDownloads = useCallback(async () => {
    if (downloadingRef.current) return;
    const queue = convertQueueRef.current;
    if (!queue.length) return;

    downloadingRef.current = true;
    convertQueueRef.current = [];
    setConvertQueue([]);
    setConvertingSet((prev) => {
      const next = new Set(prev);
      for (const bvid of queue) next.add(bvid);
      return next;
    });

    const videos = queue.map((bvid) => downloadItemsRef.current.get(bvid) ?? {
      bvid,
      title: bvid,
      author: "",
      url: `https://www.bilibili.com/video/${bvid}`,
    });

    try {
      const res = await fetch("/api/bili/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos }),
      });
      const json = (await res.json()) as { tracks?: Track[]; error?: string; hint?: string };
      if (!res.ok) {
        const reason = (json.error || json.hint || "download failed").replace(/^Error:\s*/i, "");
        throw new Error(reason);
      }

      const tracks = Array.isArray(json.tracks) ? json.tracks : [];
      setConvertedSet((prev) => {
        const next = new Set(prev);
        for (const video of videos) next.add(video.bvid);
        return next;
      });
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "agent",
          content: tracks.length
            ? `已下载到曲库，并加入播放列表。\n\n\`\`\`added\n${JSON.stringify(tracks, null, 2)}\n\`\`\``
            : "下载流程完成，但没有在曲库里扫描到新增音频文件。",
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "system",
          content: `下载失败：${message}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      for (const bvid of queue) downloadItemsRef.current.delete(bvid);
      setConvertingSet((prev) => {
        const next = new Set(prev);
        for (const bvid of queue) next.delete(bvid);
        return next;
      });
      downloadingRef.current = false;
      if (convertQueueRef.current.length > 0) {
        setTimeout(() => void flushDownloads(), 50);
      }
    }
  }, []);

  useEffect(() => {
    if (!convertQueue.length || downloadingRef.current) return;
    if (!convertQueueRef.current.length) {
      convertQueueRef.current = convertQueue;
    }
    void flushDownloads();
  }, [convertQueue, flushDownloads]);

  const queueConvert = useCallback(
    (items: Array<string | Pick<Track, "bvid" | "title" | "author" | "url">>) => {
      const candidates = normalizeDownloadItems(items);
      for (const item of candidates) {
        downloadItemsRef.current.set(item.bvid, item);
      }

      const existing = new Set([
        ...convertQueueRef.current,
        ...Array.from(convertingSet),
        ...Array.from(convertedSet),
      ]);
      const fresh = candidates.map((item) => item.bvid).filter((bvid) => !existing.has(bvid));
      if (!fresh.length) return;

      const next = [...convertQueueRef.current, ...fresh];
      convertQueueRef.current = next;
      setConvertQueue(next);

      if (!downloadingRef.current) {
        void flushDownloads();
      }
    },
    [convertingSet, convertedSet, flushDownloads]
  );

  const cancel = useCallback(() => {
    sseCancel();
    setConvertQueue([]);
    setConvertingSet(new Set());
    convertQueueRef.current = [];
    downloadItemsRef.current.clear();
  }, [sseCancel]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const ts = Date.now();
      setMessages((m) => {
        const next = [
          ...m,
          {
            id: newId(),
            role: "operator" as const,
            content: trimmed,
            timestamp: ts,
          },
        ];
        historyRef.current = next
          .filter((msg) => msg.role === "agent" || msg.role === "operator")
          .slice(-30)
          .map((msg) => ({ role: msg.role, content: msg.content }));
        return next;
      });

      if (shouldUseDirectWebSearch(trimmed, mode)) {
        const query = extractSearchQuery(trimmed);
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "tool",
            content: `api/web/search\n${JSON.stringify({ q: query, limit: 8 })}`,
            timestamp: Date.now(),
            toolName: "web_search",
          },
        ]);

        try {
          const params = new URLSearchParams({ q: query, limit: "8" });
          const res = await fetch(`/api/web/search?${params.toString()}`);
          const json = (await res.json()) as WebSearchResponse;
          if (!res.ok) throw new Error(json.errors?.join("; ") || "web search failed");
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "agent",
              content: formatDirectSearchMessage(json),
              timestamp: Date.now(),
            },
          ]);
        } catch (err) {
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "system",
              content: `全网搜索失败：${String(err)}`,
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }

      await send(trimmed, { history: historyRef.current });
    },
    [mode, send]
  );

  const value = useMemo<AgentCtxValue>(
    () => ({
      messages,
      loading,
      sessionId,
      sendMessage,
      queueConvert,
      cancel,
      convertQueue,
      convertingSet,
      convertedSet,
    }),
    [messages, loading, sessionId, sendMessage, queueConvert, cancel, convertQueue, convertingSet, convertedSet]
  );

  return (
    <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
  );
}

export function useAgent() {
  const v = useContext(AgentContext);
  if (!v) throw new Error("useAgent must be used within AgentProvider");
  return v;
}
