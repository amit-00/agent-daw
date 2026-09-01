"use client";

import type { PointerEventHandler, ReactElement } from "react";

import { INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function TrackHeader({ track, row, onEdit, onReorderStart }: Readonly<{
  track: Track; row: number; onEdit: () => void; onReorderStart: PointerEventHandler<HTMLButtonElement>;
}>): ReactElement {
  const selectTrack = useStudioStore((state) => state.selectTrack);
  const toggleMute = useStudioStore((state) => state.toggleMute);
  const toggleSolo = useStudioStore((state) => state.toggleSolo);
  const selected = useStudioStore((state) => state.selectedTrackId === track.id);
  return (
    <div role="group" aria-label={`${track.name} track`} className="sticky left-0 z-[3] col-start-1 flex min-w-0 flex-col border-r border-b border-white/10 bg-black" style={{ gridRow: row }}>
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-[9px] pt-3 pb-2">
        <button type="button" aria-label={`Select track ${track.name}`} aria-pressed={selected} onClick={() => selectTrack(track.id)} className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">
          <strong className="block overflow-hidden text-xs font-medium tracking-[0.01em] text-ellipsis whitespace-nowrap text-zinc-300">{track.name}</strong>
          <small className="mt-1 block overflow-hidden text-[10px] text-ellipsis whitespace-nowrap text-zinc-600">{INSTRUMENT_NAMES[track.instrumentId] ?? track.instrumentId}</small>
        </button>
        <button type="button" aria-label={`Edit ${track.name}`} onClick={onEdit} className="border-0 bg-transparent p-0 text-[10px] text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">•••</button>
      </div>
      <div className="mt-auto flex items-center gap-1 px-[9px] pb-2.5">
        <button type="button" onClick={() => toggleMute(track.id)} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} className={`h-[18px] w-[21px] rounded border text-[9px] ${track.muted ? "border-rose-400/45 bg-rose-400/20 text-rose-100" : "border-white/10 bg-zinc-900 text-zinc-500"}`}>M</button>
        <button type="button" onClick={() => toggleSolo(track.id)} aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.soloed} className={`h-[18px] w-[21px] rounded border text-[9px] ${track.soloed ? "border-amber-300/45 bg-amber-300/15 text-amber-100" : "border-white/10 bg-zinc-900 text-zinc-500"}`}>S</button>
        <button type="button" aria-label={`Reorder ${track.name}`} title="Drag to reorder; use track settings for Move up/down" onPointerDown={onReorderStart} onClick={(event) => { if (event.detail === 0) onEdit(); }} className="ml-auto h-[18px] w-[21px] touch-none cursor-grab rounded text-zinc-600 hover:text-zinc-300 focus-visible:outline-2 focus-visible:outline-violet-300 active:cursor-grabbing">⠿</button>
      </div>
    </div>
  );
}
