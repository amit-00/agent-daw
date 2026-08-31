"use client";

import { useRef, useState, type PointerEvent, type ReactElement } from "react";

import { AddTrack, TrackSettings } from "@/components/arrangement/TrackControls";
import { TrackHeader } from "@/components/arrangement/TrackHeader";
import { TrackLane } from "@/components/arrangement/TrackLane";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

interface TrackDrag {
  readonly trackId: string;
  readonly tracks: readonly Track[];
  readonly pointerId: number;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly startY: number;
  readonly clientY: number;
  readonly scrollTop: number;
}

export function Arrangement(): ReactElement {
  const project = useStudioStore((state) => state.project);
  const reorderTrack = useStudioStore((state) => state.reorderTrack);
  const scroller = useRef<HTMLDivElement>(null);
  const dragHandle = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState<TrackDrag | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTrack = project.tracks.find((track) => track.id === editingId);
  const tracks = [...project.tracks];
  if (drag && drag.tracks === project.tracks) {
    const [moved] = tracks.splice(drag.fromIndex, 1);
    tracks.splice(drag.toIndex, 0, moved!);
  }
  function positionAt(clientY: number): number {
    if (!drag) return 0;
    const delta = clientY - drag.startY + scroller.current!.scrollTop - drag.scrollTop;
    return Math.max(0, Math.min(project.tracks.length - 1, drag.fromIndex + Math.round(delta / 112)));
  }
  function cancelDrag(): void {
    setDrag(null);
    if (drag && dragHandle.current?.hasPointerCapture(drag.pointerId)) dragHandle.current.releasePointerCapture(drag.pointerId);
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, trackId: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragHandle.current = event.currentTarget;
    const index = project.tracks.findIndex((track) => track.id === trackId);
    setDrag({ trackId, tracks: project.tracks, pointerId: event.pointerId, fromIndex: index, toIndex: index,
      startY: event.clientY, clientY: event.clientY, scrollTop: scroller.current!.scrollTop });
  }
  const bars = project.arrangement.reduce((end, clip) => {
    const pattern = project.patterns.find((item) => item.id === clip.patternId);
    return Math.max(end, clip.startBar + (pattern?.lengthBars ?? 0) * clip.repeatCount);
  }, 8);
  return (
    <div ref={scroller} className="min-h-0 overflow-auto [scrollbar-color:#29292e_transparent] [scrollbar-width:thin]"
      onPointerMove={(event) => {
        if (drag && event.pointerId === drag.pointerId) setDrag({ ...drag, clientY: event.clientY, toIndex: positionAt(event.clientY) });
      }}
      onPointerUp={(event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const toIndex = positionAt(event.clientY);
        cancelDrag();
        if (drag.tracks === project.tracks) reorderTrack(drag.trackId, toIndex);
      }}
      onPointerCancel={cancelDrag} onLostPointerCapture={() => setDrag(null)}
      onKeyDown={(event) => { if (drag && event.key === "Escape") { event.preventDefault(); cancelDrag(); } }}
      onScroll={() => { if (drag) setDrag({ ...drag, toIndex: positionAt(drag.clientY) }); }}>
      <section className="relative grid min-h-full grid-cols-[154px_minmax(730px,1fr)] content-start bg-black" aria-label="Song arrangement"
        style={{ minWidth: 154 + bars * 92, gridTemplateRows: `39px repeat(${project.tracks.length},112px)` }}>
        <div className="sticky left-0 z-[3] flex items-center justify-between border-r border-b border-white/10 bg-black px-3 text-[10px] tracking-widest text-zinc-500">
          <span>TRACKS</span>
          <button ref={addButton} type="button" aria-label="Add track" onClick={() => setAdding(true)} className="rounded px-1 text-lg text-zinc-300 hover:bg-white/10">＋</button>
        </div>
        <div className="col-start-2 grid border-b border-white/10 bg-zinc-950/90 font-mono text-[10px] text-zinc-500" style={{ gridTemplateColumns: `repeat(${bars},1fr)` }}>
          {Array.from({ length: bars }, (_, index) => <span className="border-l border-white/5 px-2 py-3" key={index}>{String(index + 1).padStart(2, "0")}</span>)}
        </div>
        {project.tracks.map((track) => <TrackHeader key={track.id} row={tracks.findIndex((item) => item.id === track.id) + 2} track={track} onEdit={() => setEditingId(track.id)} onReorderStart={(event) => startDrag(event, track.id)} />)}
        {project.tracks.map((track) => <TrackLane key={track.id + "-lane"} row={tracks.findIndex((item) => item.id === track.id) + 2} track={track} bars={bars} />)}
        {project.tracks.length === 0 && <p className="col-span-2 p-6 text-xs text-zinc-500">Add a track to start arranging.</p>}
      </section>
      {adding && <AddTrack onClose={() => setAdding(false)} />}
      {editingTrack && <TrackSettings key={editingTrack.id} track={editingTrack} onClose={() => setEditingId(null)} onDeleted={() => {
        setEditingId(null);
        queueMicrotask(() => addButton.current?.focus());
      }} />}
    </div>
  );
}
