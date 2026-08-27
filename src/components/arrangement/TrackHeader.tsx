"use client";

import type { CSSProperties, ReactElement } from "react";

import { useStudioStore } from "@/stores/studio-store";
import type { Track } from "@/types/studio";

export function TrackHeader({ track, row }: Readonly<{ track: Track; row: number }>): ReactElement {
  const muted = useStudioStore((state) => state.mutedTrackIds.has(track.id));
  const soloed = useStudioStore((state) => state.soloTrackIds.has(track.id));
  const toggleMute = useStudioStore((state) => state.toggleMute);
  const toggleSolo = useStudioStore((state) => state.toggleSolo);

  return (
    <div className="sticky left-0 z-[3] col-start-1 flex min-w-0 flex-col border-r border-b border-white/10 bg-black" style={{ gridRow: row } as CSSProperties}>
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-[9px] pt-3 pb-2">
        <span className="min-w-0">
          <strong className="block overflow-hidden text-xs font-medium tracking-[0.01em] text-ellipsis whitespace-nowrap text-zinc-300">{track.name}</strong>
          <small className="mt-1 block overflow-hidden text-[10px] text-ellipsis whitespace-nowrap text-zinc-600">{track.preset}</small>
        </span>
        <button className="border-0 bg-transparent p-0 text-[10px] text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label={`More options for ${track.name}`}>•••</button>
      </div>
      <div className="mt-auto grid grid-cols-[repeat(2,21px)] items-center gap-1 px-[9px] pb-2.5">
        <button className={`h-[18px] cursor-pointer rounded border text-[9px] ${muted ? "border-rose-400/45 bg-rose-400/20 text-rose-100" : "border-white/10 bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`} type="button" aria-label={`${muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={muted} onClick={() => toggleMute(track.id)}>M</button>
        <button className={`h-[18px] cursor-pointer rounded border text-[9px] ${soloed ? "border-amber-300/45 bg-amber-300/15 text-amber-100" : "border-white/10 bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`} type="button" aria-label={`${soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={soloed} onClick={() => toggleSolo(track.id)}>S</button>
      </div>
    </div>
  );
}
