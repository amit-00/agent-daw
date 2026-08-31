import type { ReactElement } from "react";

type IconName = "activity" | "chevron" | "download" | "draw" | "mixer";
type TransportIconName = "loop" | "pause" | "play" | "record" | "redo" | "speaker" | "stop" | "undo";

const ICONS: Readonly<Record<IconName, string>> = {
  activity: "⌁",
  chevron: "›",
  download: "⇩",
  draw: "✎",
  mixer: "≡",
};

export function Icon({ name, size = 16 }: Readonly<{ name: IconName; size?: number }>): ReactElement {
  return (
    <span className="inline-grid w-[1em] place-items-center leading-none" style={{ fontSize: size }} aria-hidden="true">
      {ICONS[name]}
    </span>
  );
}

export function TransportIcon({ name }: Readonly<{ name: TransportIconName }>): ReactElement {
  return (
    <svg className="h-[15px] w-[15px] fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true">
      {name === "play" ? <path d="m8 5 11 7-11 7V5Z" fill="currentColor" /> : null}
      {name === "pause" ? <path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor" /> : null}
      {name === "stop" ? <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" /> : null}
      {name === "record" ? <circle cx="12" cy="12" r="4" fill="currentColor" /> : null}
      {name === "loop" ? <path d="M17.5 7H8a5 5 0 0 0-5 5m3.5 5H16a5 5 0 0 0 5-5M17 3.5 20.5 7 17 10.5M7 13.5 3.5 17 7 20.5" /> : null}
      {name === "undo" ? <path d="M9 8H4m0 0 3-3M4 8l3 3m-3-3h9a5 5 0 0 1 5 5v1" /> : null}
      {name === "redo" ? <path d="M15 8h5m0 0-3-3m3 3-3 3m3-3h-9a5 5 0 0 0-5 5v1" /> : null}
      {name === "speaker" ? <path d="M5 10v4h3l4 3V7L8 10H5Zm10-1.5a5 5 0 0 1 0 7m2-9a8 8 0 0 1 0 11" /> : null}
    </svg>
  );
}
