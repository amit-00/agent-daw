"use client";

import type { ReactElement } from "react";

import { useStudioStore } from "@/stores/studio-store";
import type { Track } from "@/types/studio";

export function ChannelStrip({ track }: Readonly<{ track: Track }>): ReactElement {
  const muted = useStudioStore((state) => state.mutedTrackIds.has(track.id));
  const soloed = useStudioStore((state) => state.soloTrackIds.has(track.id));
  const toggleMute = useStudioStore((state) => state.toggleMute);
  const toggleSolo = useStudioStore((state) => state.toggleSolo);

  return (
    <div className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] border-r border-white/[0.055] px-5 pt-[11px] pb-[9px]">
      <span className="col-span-full overflow-hidden text-center text-[10px] text-ellipsis whitespace-nowrap text-zinc-400">{track.name.split(" ")[0]}</span>
      <span className="col-span-full row-start-2 flex h-[142px] w-3 items-end gap-[3px] self-center justify-self-center">
        <i className="w-1 rounded-full bg-[linear-gradient(0deg,#81e0a0_0_72%,#e2c66c_72%_90%,#ee6678_90%)] opacity-70" style={{ height: `${track.volume}%` }} />
        <i className="w-1 rounded-full bg-[linear-gradient(0deg,#81e0a0_0_72%,#e2c66c_72%_90%,#ee6678_90%)] opacity-70" style={{ height: `${track.volume - 8}%` }} />
      </span>
      <label className="col-span-full row-start-3 grid gap-1 text-[9px] text-zinc-500"><span>Volume</span><input className="m-0 h-[3px] w-full [accent-color:#d4d4d8]" aria-label={`${track.name} volume`} type="range" min="0" max="100" defaultValue={track.volume} /></label>
      <label className="col-span-full row-start-4 grid gap-1 text-[9px] text-zinc-500"><span>Pan</span><input className="m-0 h-[3px] w-full [accent-color:#87878f]" aria-label={`${track.name} pan`} type="range" min="0" max="100" defaultValue="50" /></label>
      <div className="col-span-full row-start-5 grid grid-cols-2 gap-[3px]">
        <button className={`cursor-pointer rounded border border-white/10 text-[9px] ${muted ? "bg-rose-400/20 text-rose-100" : "bg-white/[0.025] text-zinc-600"}`} type="button" aria-label={`${muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={muted} onClick={() => toggleMute(track.id)}>M</button>
        <button className={`cursor-pointer rounded border border-white/10 text-[9px] ${soloed ? "bg-amber-300/15 text-amber-100" : "bg-white/[0.025] text-zinc-600"}`} type="button" aria-label={`${soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={soloed} onClick={() => toggleSolo(track.id)}>S</button>
      </div>
    </div>
  );
}
