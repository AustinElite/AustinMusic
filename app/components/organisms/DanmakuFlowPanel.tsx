"use client";

import { GlowDot } from "@/app/components/atoms/GlowDot";
import { Label } from "@/app/components/atoms/Label";
import { useDanmaku } from "@/app/context/DanmakuContext";
import { usePlayer } from "@/app/context/PlayerContext";
import { useMemo, type CSSProperties } from "react";

const AMBIENT_LINES = [
  "来了",
  "节奏进来了",
  "这段好听",
  "耳机党狂喜",
  "前方高能",
  "循环预定",
  "声场打开",
  "一起听",
  "弹幕同步",
  "现场感拉满",
  "加油",
  "副歌来了",
];

const COLORS = ["#ffffff", "#6feee1", "#ff4bd8", "#00b7ff", "#ffe900"];

export function DanmakuFlowPanel() {
  const { state } = usePlayer();
  const { enabled, currentDanmaku } = useDanmaku();
  const title = state.current?.title?.trim();

  const lines = useMemo(() => {
    const liveLines = enabled && currentDanmaku.length > 0
      ? currentDanmaku.slice(0, 16).map((item) => item.content)
      : [];
    const seeded = title ? [title.slice(0, 20), ...AMBIENT_LINES] : AMBIENT_LINES;
    return liveLines.length ? liveLines : seeded;
  }, [currentDanmaku, enabled, title]);

  return (
    <section
      className="relative h-32 shrink-0 overflow-hidden rounded-sm border"
      style={{
        borderColor: "var(--color-surface-container-high)",
        backgroundColor: "color-mix(in srgb, var(--color-surface-container-low) 90%, transparent)",
      }}
      aria-label="Danmaku flow"
    >
      <style>{`
        @keyframes queue-danmaku-flow {
          from { transform: translateX(0) scale(var(--dm-scale)); opacity: 0; }
          8%, 84% { opacity: var(--dm-opacity); }
          to { transform: translateX(-74rem) scale(var(--dm-scale)); opacity: 0; }
        }
        @keyframes queue-danmaku-scan {
          from { transform: translateY(-100%); opacity: 0; }
          35% { opacity: 0.13; }
          to { transform: translateY(100%); opacity: 0; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, color-mix(in srgb, var(--color-on-surface) 4%, transparent) 1px, transparent 1px)",
          backgroundSize: "100% 16px",
          opacity: 0.5,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        style={{ animation: "queue-danmaku-scan 4.8s linear infinite" }}
      >
        <div className="h-full" style={{ background: "linear-gradient(to bottom, transparent, var(--color-primary), transparent)" }} />
      </div>

      <header
        className="relative z-10 flex items-center gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--color-outline-variant)" }}
      >
        <GlowDot color="primary" size={7} className={state.playing ? "" : "opacity-55"} />
        <Label size="sm" className="text-[color:var(--color-on-surface)]">
          DANMAKU_FLOW
        </Label>
        <span
          className="ml-auto text-[10px] font-semibold uppercase"
          style={{
            color: enabled && currentDanmaku.length ? "var(--color-primary)" : "var(--color-outline)",
            fontFamily: "var(--font-headline)",
            letterSpacing: "0.16em",
          }}
        >
          {enabled && currentDanmaku.length ? "LIVE" : "AMBIENT"}
        </span>
      </header>

      <div className="absolute inset-x-0 bottom-0 top-9 overflow-hidden" aria-hidden>
        {lines.map((line, index) => {
          const top = 7 + ((index * 17) % 76);
          const duration = 9 + (index % 5) * 1.35;
          const delay = -(index * 1.7);
          const scale = index % 6 === 0 ? 1.12 : index % 3 === 0 ? 0.92 : 1;

          return (
            <span
              key={`${line}-${index}`}
              className="absolute left-full whitespace-nowrap text-sm font-semibold"
              style={
                {
                  top: `${top}%`,
                  color: COLORS[index % COLORS.length],
                  fontFamily: "var(--font-headline), ui-sans-serif, system-ui",
                  textShadow: "0 0 4px rgba(0,0,0,0.92), 0 0 12px rgba(111,238,225,0.28)",
                  animation: `queue-danmaku-flow ${duration}s linear ${delay}s infinite`,
                  "--dm-opacity": index % 4 === 0 ? 0.95 : 0.72,
                  "--dm-scale": scale,
                } as CSSProperties
              }
            >
              {line}
            </span>
          );
        })}
      </div>
    </section>
  );
}
