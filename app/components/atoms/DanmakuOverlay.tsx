"use client";

import type { DanmakuItem } from "@/app/lib/bili";
import { useDanmaku } from "@/app/context/DanmakuContext";
import { usePlayer } from "@/app/context/PlayerContext";
import { useCallback, useEffect, useMemo, useReducer, useRef, type CSSProperties } from "react";

const SCROLL_DURATION = 12;
const LOOKAHEAD = 0.3;
const AMBIENT_LINES = [
  "来了",
  "太顶了",
  "节奏进来了",
  "耳机党狂喜",
  "这段好听",
  "前方高能",
  "循环预定",
  "声场打开",
  "一起听",
  "弹幕同步",
  "加油",
  "现场感拉满",
];
const AMBIENT_COLORS = [
  "#ffffff",
  "#6feee1",
  "#ff4bd8",
  "#00b7ff",
  "#ffe900",
];

type ActiveDanmaku = DanmakuItem & { spawnId: number };
type ActiveAction =
  | { type: "spawn"; item: ActiveDanmaku }
  | { type: "remove"; spawnId: number }
  | { type: "clear" };

let spawnIdCounter = 0;

function activeDanmakuReducer(active: ActiveDanmaku[], action: ActiveAction) {
  if (action.type === "spawn") return [...active, action.item];
  if (action.type === "remove") return active.filter((d) => d.spawnId !== action.spawnId);
  return [];
}

export function DanmakuOverlay() {
  const { state } = usePlayer();
  const { enabled, currentDanmaku } = useDanmaku();

  const [active, dispatchActive] = useReducer(activeDanmakuReducer, []);
  const lastProgressRef = useRef(0);
  const lastIndexRef = useRef(0);

  const progress = state.progress;
  const showTimedDanmaku = enabled && currentDanmaku.length > 0;
  const currentTitle = state.current?.title?.trim();
  const ambientLines = useMemo(() => {
    return currentTitle ? [currentTitle.slice(0, 18), ...AMBIENT_LINES] : AMBIENT_LINES;
  }, [currentTitle]);

  const spawnDanmaku = useCallback(
    (item: DanmakuItem) => {
      const spawnId = ++spawnIdCounter;
      dispatchActive({ type: "spawn", item: { ...item, spawnId } });
      setTimeout(() => {
        dispatchActive({ type: "remove", spawnId });
      }, SCROLL_DURATION * 1000 + 500);
    },
    []
  );

  useEffect(() => {
    if (!showTimedDanmaku) {
      dispatchActive({ type: "clear" });
      lastIndexRef.current = 0;
      lastProgressRef.current = progress;
      return;
    }

    const delta = progress - lastProgressRef.current;
    const seeked = delta < -1 || delta > 3;
    lastProgressRef.current = progress;

    if (seeked) {
      dispatchActive({ type: "clear" });
      lastIndexRef.current = 0;
      if (progress <= 0) return;
      const resumeIdx = currentDanmaku.findIndex(
        (d) => d.time >= progress - LOOKAHEAD
      );
      lastIndexRef.current = Math.max(0, resumeIdx);
    }

    const target = progress + LOOKAHEAD;
    const items = currentDanmaku;
    let idx = lastIndexRef.current;
    while (idx < items.length && items[idx]!.time <= target) {
      spawnDanmaku(items[idx]!);
      idx++;
    }
    lastIndexRef.current = idx;
  }, [progress, showTimedDanmaku, currentDanmaku, spawnDanmaku]);

  const rows = 5;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      aria-hidden
    >
      <style>{`
        @keyframes dm-scroll {
          from { transform: translateX(0) scale(var(--dm-scale)); opacity: 0; }
          8% { opacity: var(--dm-opacity); }
          88% { opacity: var(--dm-opacity); }
          to { transform: translateX(-76rem) scale(var(--dm-scale)); opacity: 0; }
        }
        @keyframes dm-ambient {
          from { transform: translateX(0) scale(var(--dm-scale)); opacity: 0; }
          8% { opacity: var(--dm-opacity); }
          88% { opacity: var(--dm-opacity); }
          to { transform: translateX(-76rem) scale(var(--dm-scale)); opacity: 0; }
        }
        @keyframes dm-glitch {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(111,238,225,0.32)); }
          45% { filter: drop-shadow(0 0 9px rgba(111,238,225,0.72)); }
        }
      `}</style>
      <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
        {ambientLines.map((line, index) => {
          const top = 5 + ((index * 13) % 84);
          const duration = 10 + (index % 6) * 1.4;
          const delay = -(index * 1.9);
          const scale = index % 5 === 0 ? 1.14 : index % 3 === 0 ? 0.92 : 1;

          return (
            <span
              key={`${line}-${index}`}
              className="absolute whitespace-nowrap text-sm font-semibold"
              style={
                {
                  left: "100%",
                  top: `${top}%`,
                  color: AMBIENT_COLORS[index % AMBIENT_COLORS.length],
                  animation: `dm-ambient ${duration}s linear ${delay}s infinite, dm-glitch 2.6s ease-in-out ${index * 0.14}s infinite`,
                  fontFamily: "var(--font-headline), ui-sans-serif, system-ui",
                  opacity: 0,
                  textShadow: "0 0 4px rgba(0,0,0,0.92), 0 0 12px rgba(111,238,225,0.28)",
                  "--dm-opacity": index % 4 === 0 ? 0.92 : 0.68,
                  "--dm-scale": scale,
                } as CSSProperties
              }
            >
              {line}
            </span>
          );
        })}
      </div>
      {active.map((d) => {
        const row = d.spawnId % rows;
        const topPct = (row / rows) * 80;
        return (
          <span
            key={d.spawnId}
            className="absolute left-full whitespace-nowrap text-sm font-medium"
            style={
              {
              top: `${topPct + (d.spawnId * 7) % 15}%`,
              animation: `dm-scroll ${SCROLL_DURATION}s linear forwards`,
              color: d.color,
              fontFamily: "var(--font-headline), 'Space Grotesk', sans-serif",
              textShadow:
                "0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.9)",
              "--dm-opacity": 0.96,
              "--dm-scale": 1,
              } as CSSProperties
            }
          >
            {d.content}
          </span>
        );
      })}
    </div>
  );
}
