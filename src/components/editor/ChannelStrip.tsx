import type { ReactElement } from "react";

import { getTrackColor, INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";

export function ChannelStrip({ track }: Readonly<{ track: Track }>): ReactElement {
  return (
    <div role="group" aria-label={`${track.name} channel`} className="flex w-[210px] shrink-0 flex-col gap-4 border-r border-white/10 px-5 py-4" style={{ borderTop: `2px solid ${getTrackColor(track.id)}` }}>
      <span className="truncate text-center text-xs text-zinc-300">{track.name}</span>
      <small className="text-center text-[10px] text-zinc-500">{INSTRUMENT_NAMES[track.instrumentId] ?? track.instrumentId}</small>
      <label className="mt-auto grid gap-2 text-[10px] text-zinc-400"><span>Volume · {track.volumeDb} dB</span><input disabled aria-label={`${track.name} volume`} type="range" min="-60" max="6" value={track.volumeDb} /></label>
      <label className="grid gap-2 text-[10px] text-zinc-400"><span>Pan · {track.pan}</span><input disabled aria-label={`${track.name} pan`} type="range" min="-1" max="1" step="0.01" value={track.pan} /></label>
      <div className="grid grid-cols-2 gap-1">
        <button disabled type="button" aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} className="rounded border border-white/10 text-[10px] text-zinc-600">M</button>
        <button disabled type="button" aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.soloed} className="rounded border border-white/10 text-[10px] text-zinc-600">S</button>
      </div>
    </div>
  );
}
