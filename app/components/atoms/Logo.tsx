export function Logo({ className }: { className?: string }) {
  return (
    <div
      className={["flex items-center gap-3", className].filter(Boolean).join(" ")}
      aria-label="Austin Music"
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        role="img"
        aria-hidden="true"
        className="h-9 w-9 shrink-0 md:h-10 md:w-10"
      >
        <defs>
          <linearGradient id="aura-pulse-mark" x1="6" x2="38" y1="8" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6feee1" />
            <stop offset="0.58" stopColor="#8af7ff" />
            <stop offset="1" stopColor="#bcc7de" />
          </linearGradient>
        </defs>
        <path
          d="M22 5.5c9.1 0 16.5 7.4 16.5 16.5S31.1 38.5 22 38.5 5.5 31.1 5.5 22"
          fill="none"
          stroke="url(#aura-pulse-mark)"
          strokeLinecap="round"
          strokeWidth="1.6"
          opacity="0.82"
        />
        <path
          d="M7.3 24.8C6 15.9 12.9 7 22 7c5.1 0 9.7 2.4 12.6 6.2"
          fill="none"
          stroke="var(--color-primary)"
          strokeDasharray="1.5 4"
          strokeLinecap="round"
          strokeWidth="1.4"
          opacity="0.7"
        />
        <path
          d="M11 25.5h3.2l2.9-8.8 4.6 15.2 5.1-20.4 3.7 14h2.5"
          fill="none"
          stroke="url(#aura-pulse-mark)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.4"
        />
        <path
          d="M14.5 29.5h15"
          fill="none"
          stroke="var(--color-primary)"
          strokeLinecap="round"
          strokeWidth="1.2"
          opacity="0.45"
        />
        <circle cx="34.6" cy="14.2" r="2.3" fill="var(--color-primary)" opacity="0.95" />
      </svg>

      <span className="grid leading-none">
        <span
          className="text-[22px] font-semibold md:text-[26px]"
          style={{
            color: "var(--color-primary)",
            fontFamily: "var(--font-headline)",
            letterSpacing: "0.06em",
            textShadow: "0 0 16px var(--color-crt-glow-soft)",
          }}
        >
          Austin Music
        </span>
        <span
          className="mt-1 hidden text-[9px] font-semibold uppercase md:block"
          style={{
            color: "var(--color-outline)",
            fontFamily: "var(--font-headline)",
            letterSpacing: "0.24em",
          }}
        >
          AI Music Agent
        </span>
      </span>
    </div>
  );
}
