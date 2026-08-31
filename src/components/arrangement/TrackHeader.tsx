"use client";

import type { PointerEventHandler, ReactElement } from "react";

import { getTrackColor, INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function TrackHeader({ track, row, onEdit, onReorderStart }: Readonly<{
  track: Track; row: number; onEdit: () => void; onReorderStart: PointerEventHandler<HTMLButtonElement>;
}>): ReactElement {
  const selectTrack = useStudioStore((state) => state.selectTrack);
  const selected = useStudioStore((state) => state.selectedTrackId === track.id);
  return (
    <div className="sticky left-0 z-[3] col-start-1 flex min-w-0 flex-col border-r border-b border-white/10 bg-black px-2.5 py-3" style={{ gridRow: row, borderLeft: `3px solid ${getTrackColor(track.id)}` }}>
      <button type="button" aria-label={`Select track ${track.name}`} aria-pressed={selected} onClick={() => selectTrack(track.id)} className={`truncate text-left text-xs ${selected ? "text-white" : "text-zinc-400"}`}>{track.name}</button>
      <small className="mt-1 truncate text-[10px] text-zinc-500">{INSTRUMENT_NAMES[track.instrumentId] ?? track.instrumentId}</small>
      <div className="mt-auto flex gap-1">
        <button type="button" aria-label={`Reorder ${track.name}`} title="Drag to reorder; use track settings for Move up/down" onPointerDown={onReorderStart} onClick={(event) => { if (event.detail === 0) onEdit(); }} className="h-6 w-5 touch-none cursor-grab rounded text-zinc-500 hover:bg-white/10 active:cursor-grabbing">⠿</button>
        <button disabled type="button" aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} className="h-5 w-6 rounded border border-white/10 text-[9px] text-zinc-600">M</button>
        <button disabled type="button" aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.soloed} className="h-5 w-6 rounded border border-white/10 text-[9px] text-zinc-600">S</button>
        <button type="button" aria-label={`Edit ${track.name}`} onClick={onEdit} className="ml-auto h-6 w-6 rounded text-zinc-400 hover:bg-white/10">⋯</button>
      </div>
    </div>
  );
}
