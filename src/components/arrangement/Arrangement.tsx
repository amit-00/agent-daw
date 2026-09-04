"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

import { AddTrack, TrackSettings } from "@/components/arrangement/TrackControls";
import { TrackHeader } from "@/components/arrangement/TrackHeader";
import { TrackLane } from "@/components/arrangement/TrackLane";
import { ClipSettings } from "@/components/editor/PatternControls";
import { PROJECT_CAPS, type Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export const ARRANGEMENT_BUFFER_BARS = 4;
const ARRANGEMENT_BAR_WIDTH = 100;
const ARRANGEMENT_MIN_BARS = 16;
const TRACK_COLUMN_WIDTH = 154;

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

interface PlayheadDrag {
  readonly pointerId: number;
  readonly grabOffset: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const playheadLabel = (step: number): string =>
  `Bar ${Math.floor(step / 16) + 1}, beat ${Math.floor((step % 16) / 4) + 1}, step ${(step % 4) + 1}`;

export function Arrangement({ previewEndBar = null }: Readonly<{ previewEndBar?: number | null }>): ReactElement {
  const project = useStudioStore((state) => state.project);
  const audio = useStudioStore((state) => state.audio);
  const reorderTrack = useStudioStore((state) => state.reorderTrack);
  const seekPlayback = useStudioStore((state) => state.seekPlayback);
  const scroller = useRef<HTMLDivElement>(null);
  const arrangement = useRef<HTMLElement>(null);
  const dragHandle = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState<TrackDrag | null>(null);
  const playheadDrag = useRef<PlayheadDrag | null>(null);
  const [seekPreviewStep, setSeekPreviewStep] = useState<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const editingTrack = project.tracks.find((track) => track.id === editingId);
  const editingClip = project.arrangement.find((clip) => clip.id === editingClipId);
  const editingPattern = project.patterns.find((pattern) => pattern.id === editingClip?.patternId);
  function closeClipSettings(): void {
    const lane = Array.from(scroller.current!.querySelectorAll<HTMLElement>("[data-track-id]"))
      .find((element) => element.dataset.trackId === editingClip?.trackId);
    setEditingClipId(null);
    queueMicrotask(() => lane?.focus());
  }
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
  const furthestClipEnd = project.arrangement.reduce((end, clip) => {
    const pattern = project.patterns.find((item) => item.id === clip.patternId);
    return Math.max(end, clip.startBar + (pattern?.lengthBars ?? 0) * clip.repeatCount);
  }, 0);
  const bars = Math.min(PROJECT_CAPS.maxArrangementBars,
    Math.max(ARRANGEMENT_MIN_BARS, furthestClipEnd + ARRANGEMENT_BUFFER_BARS, (previewEndBar ?? 0) + ARRANGEMENT_BUFFER_BARS));
  const transportEndStep = audio.snapshot.arrangementEndStep;
  const displayedStep = Math.min(seekPreviewStep ?? audio.snapshot.positionStep, transportEndStep);
  const playheadLeft = TRACK_COLUMN_WIDTH + displayedStep / 16 * ARRANGEMENT_BAR_WIDTH;

  function playheadStepAt(clientX: number, grabOffset: number): number {
    const left = arrangement.current!.getBoundingClientRect().left + TRACK_COLUMN_WIDTH + grabOffset;
    return clamp(Math.round((clientX - left) / (ARRANGEMENT_BAR_WIDTH / 16)), 0, transportEndStep);
  }

  function startPlayheadDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || playheadDrag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const headX = arrangement.current!.getBoundingClientRect().left + playheadLeft;
    const grabOffset = event.clientX - headX;
    playheadDrag.current = { pointerId: event.pointerId, grabOffset };
    setSeekPreviewStep(playheadStepAt(event.clientX, grabOffset));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePlayhead(event: PointerEvent<HTMLDivElement>): void {
    const current = playheadDrag.current;
    if (event.pointerId === current?.pointerId) setSeekPreviewStep(playheadStepAt(event.clientX, current.grabOffset));
  }

  function finishPlayheadDrag(event: PointerEvent<HTMLDivElement>): void {
    const current = playheadDrag.current;
    if (event.pointerId !== current?.pointerId) return;
    playheadDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSeekPreviewStep(null);
    seekPlayback(playheadStepAt(event.clientX, current.grabOffset));
  }

  function cancelPlayheadDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerId !== playheadDrag.current?.pointerId) return;
    playheadDrag.current = null;
    setSeekPreviewStep(null);
  }

  function movePlayheadWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    seekPlayback(clamp(Math.floor(displayedStep) + (event.key === "ArrowRight" ? 1 : -1), 0, transportEndStep));
  }

  return (
    <div ref={scroller} data-arrangement-scroll className="min-h-0 overflow-auto [scrollbar-color:#29292e_transparent] [scrollbar-width:thin]"
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
      <section ref={arrangement} data-bars={bars} className="relative grid h-full min-h-[650px] content-start bg-black bg-[linear-gradient(90deg,rgba(255,255,255,0.12)_2px,transparent_2px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-position:154px_0,154px_0]" aria-label="Song arrangement"
        style={{ width: TRACK_COLUMN_WIDTH + bars * ARRANGEMENT_BAR_WIDTH,
          gridTemplateColumns: `${TRACK_COLUMN_WIDTH}px ${bars * ARRANGEMENT_BAR_WIDTH}px`,
          gridTemplateRows: `39px repeat(${project.tracks.length},112px)`,
          backgroundSize: `${ARRANGEMENT_BAR_WIDTH * 4}px 100%, ${ARRANGEMENT_BAR_WIDTH / 2}px 100%` }}>
        <div data-track-column className="sticky left-0 z-[3] flex items-center justify-between border-r border-b border-white/10 bg-black px-[11px] text-xs tracking-[0.12em] text-zinc-600">
          <span>TRACKS</span>
          <button ref={addButton} type="button" aria-label="Add track" onClick={() => setAdding(true)} className="border-0 bg-transparent text-[15px] text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">＋</button>
        </div>
        <div className="col-start-2 grid border-b border-white/10 bg-zinc-950/90 font-mono text-xs text-zinc-600" style={{ gridTemplateColumns: `repeat(${bars},${ARRANGEMENT_BAR_WIDTH}px)` }}>
          {Array.from({ length: bars }, (_, index) => <span className="border-l border-white/[0.045] px-[7px] py-[13px]" key={index}>{String(index + 1).padStart(2, "0")}</span>)}
        </div>
        {project.tracks.map((track) => <TrackHeader key={track.id} row={tracks.findIndex((item) => item.id === track.id) + 2} track={track} onEdit={() => setEditingId(track.id)} onReorderStart={(event) => startDrag(event, track.id)} />)}
        {project.tracks.map((track) => <TrackLane key={track.id + "-lane"} row={tracks.findIndex((item) => item.id === track.id) + 2} track={track} bars={bars} onEditClip={setEditingClipId} />)}
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-white/90" style={{ left: playheadLeft }} />
        <div role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={transportEndStep} aria-valuenow={displayedStep}
          aria-valuetext={playheadLabel(Math.floor(displayedStep))} tabIndex={0} style={{ left: playheadLeft }}
          onPointerDown={startPlayheadDrag} onPointerMove={movePlayhead} onPointerUp={finishPlayheadDrag}
          onPointerCancel={cancelPlayheadDrag} onLostPointerCapture={cancelPlayheadDrag} onKeyDown={movePlayheadWithKeyboard}
          className="absolute top-[29px] z-[2] grid h-5 w-4 -translate-x-1/2 touch-none cursor-col-resize place-items-center focus-visible:outline-2 focus-visible:outline-violet-300">
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-b-full rounded-t-sm bg-white" />
        </div>
      </section>
      {adding && <AddTrack onClose={() => setAdding(false)} />}
      {editingClip && editingPattern && <ClipSettings key={editingPattern.id} clip={editingClip} pattern={editingPattern}
        onClose={closeClipSettings} />}
      {editingTrack && <TrackSettings key={editingTrack.id} track={editingTrack} onClose={() => setEditingId(null)} onDeleted={() => {
        setEditingId(null);
        queueMicrotask(() => addButton.current?.focus());
      }} />}
    </div>
  );
}
