import type { ReactElement } from "react";

import { INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";

export function ChannelStrip({ track }: Readonly<{ track: Track }>): ReactElement {
  return (
    <div role="group" aria-label={`${track.name} channel`} className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] border-r border-white/[0.055] px-5 pt-[11px] pb-[9px]">
      <span className="col-span-full overflow-hidden text-center text-[10px] text-ellipsis whitespace-nowrap text-zinc-400">{track.name}</span>
      <small className="col-span-full row-start-2 self-start text-center text-[9px] text-zinc-600">{INSTRUMENT_NAMES[track.instrumentId] ?? track.instrumentId}</small>
      <span className="col-span-full row-start-2 flex h-[142px] w-3 items-end gap-[3px] self-center justify-self-center" aria-hidden="true" title="Audio disconnected">
        <i className="h-full w-1 rounded-full bg-zinc-800/50" /><i className="h-full w-1 rounded-full bg-zinc-800/50" />
      </span>
      <label className="col-span-full row-start-3 grid gap-1 text-[9px] text-zinc-500"><span>Volume · {track.volumeDb} dB</span><input disabled className="m-0 h-[3px] w-full [accent-color:#d4d4d8]" aria-label={`${track.name} volume`} type="range" min="-60" max="6" value={track.volumeDb} /></label>
      <label className="col-span-full row-start-4 grid gap-1 text-[9px] text-zinc-500"><span>Pan · {track.pan}</span><input disabled className="m-0 h-[3px] w-full [accent-color:#87878f]" aria-label={`${track.name} pan`} type="range" min="-1" max="1" step="0.01" value={track.pan} /></label>
      <div className="col-span-full row-start-5 grid grid-cols-2 gap-[3px]">
        <button disabled type="button" aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} className={`rounded border border-white/10 text-[9px] ${track.muted ? "bg-rose-400/20 text-rose-100" : "bg-white/[0.025] text-zinc-600"}`}>M</button>
        <button disabled type="button" aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.soloed} className={`rounded border border-white/10 text-[9px] ${track.soloed ? "bg-amber-300/15 text-amber-100" : "bg-white/[0.025] text-zinc-600"}`}>S</button>
      </div>
    </div>
  );
}
