"use client";

import { useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getTrackColor } from "@/data/studio-data";
import type { ArrangementClip } from "@/project";
import { getPlacementProblem } from "@/stores/studio-edits";
import { useStudioStore } from "@/stores/studio-provider";

interface PlacementPreview {
  readonly clip: ArrangementClip;
  readonly lane: HTMLElement | null;
  readonly problem: string | null;
  readonly bars: number;
}

interface PlacementDrag {
  readonly kind: "move" | "resize" | "place";
  readonly clip: ArrangementClip;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly laneLeft: number;
  readonly pixelsPerBar: number;
  readonly lengthBars: number;
  readonly bars: number;
  readonly scroller: HTMLElement;
  clientX: number;
  clientY: number;
  preview: PlacementPreview | null;
}

export function ArrangementGestures({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const { project, updateClip, placePattern, deleteClip, selectClip, selectPattern } = useStudioStore((state) => state);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<PlacementDrag | null>(null);
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function candidateAt(current: PlacementDrag, clientX: number, clientY: number): PlacementPreview {
    const lanes = Array.from(current.scroller.querySelectorAll<HTMLElement>("[data-track-id]"));
    const source = lanes.find((lane) => lane.dataset.trackId === current.clip.trackId);
    const viewport = current.scroller.getBoundingClientRect();
    const lane = current.kind === "resize" ? source : lanes.find((item) => {
      const rect = item.getBoundingClientRect();
      return clientX >= Math.max(rect.left, viewport.left + 154) && clientX < Math.min(rect.right, viewport.right) &&
        clientY >= Math.max(rect.top, viewport.top) && clientY < Math.min(rect.bottom, viewport.bottom);
    });
    if (!lane) return { clip: current.clip, lane: null, bars: current.bars, problem: "Drop inside a track lane. Use clip settings for an exact placement." };
    const rect = lane.getBoundingClientRect();
    const deltaBars = (clientX - current.startX + current.laneLeft - rect.left) / current.pixelsPerBar;
    const clip: ArrangementClip = { ...current.clip, trackId: lane.dataset.trackId!,
      startBar: current.kind === "place" ? Math.floor((clientX - rect.left) / rect.width * current.bars)
        : current.kind === "move" ? Math.max(0, current.clip.startBar + Math.round(deltaBars)) : current.clip.startBar,
      repeatCount: current.kind === "resize"
        ? Math.max(1, Math.min(64, Math.round(current.clip.repeatCount + deltaBars / current.lengthBars))) : current.clip.repeatCount };
    return { clip, lane, bars: current.bars, problem: getPlacementProblem(project, clip) };
  }

  function cancel(): void {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (current && surface.current?.hasPointerCapture(current.pointerId)) surface.current.releasePointerCapture(current.pointerId);
  }

  function start(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || drag.current || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-clip-id], button[data-resize-clip-id], button[data-pattern-id]");
    if (!button) return;
    const scroller = surface.current!.querySelector<HTMLElement>("[data-arrangement-scroll]")!;
    const bars = Number(scroller.querySelector<HTMLElement>("[data-bars]")!.dataset.bars);
    const clipId = button.dataset.clipId ?? button.dataset.resizeClipId;
    const clip = clipId ? project.arrangement.find((item) => item.id === clipId) : undefined;
    const pattern = project.patterns.find((item) => item.id === (clip?.patternId ?? button.dataset.patternId));
    if (!pattern) return;
    const lane = Array.from(scroller.querySelectorAll<HTMLElement>("[data-track-id]"))
      .find((item) => !clip || item.dataset.trackId === clip.trackId);
    if (clip) selectClip(clip.id); else selectPattern(pattern.id);
    setMessage(null);
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    event.preventDefault();
    button.focus({ preventScroll: true });
    surface.current!.setPointerCapture(event.pointerId);
    drag.current = { kind: button.dataset.resizeClipId ? "resize" : clip ? "move" : "place",
      clip: clip ?? { id: "", patternId: pattern.id, trackId: "", startBar: 0, repeatCount: 1 },
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, laneLeft: rect.left,
      pixelsPerBar: rect.width / bars, lengthBars: pattern.lengthBars, bars, scroller, preview: null };
  }

  function move(clientX: number, clientY: number): void {
    const current = drag.current;
    if (!current) return;
    current.clientX = clientX;
    current.clientY = clientY;
    current.preview = candidateAt(current, clientX, clientY);
    setPreview(current.preview);
  }

  function finish(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const result = current.preview?.lane && !project.tracks.some((track) => track.id === current.preview!.clip.trackId)
      ? current.preview : candidateAt(current, event.clientX, event.clientY);
    cancel();
    if (current.kind === "place" && event.clientX === current.startX && event.clientY === current.startY) return;
    if (!result.lane) { setMessage(result.problem); return; }
    const clipId = current.kind === "place" ? placePattern(current.clip.patternId, result.clip.trackId, result.clip.startBar) : current.clip.id;
    if (current.kind !== "place") updateClip(current.clip.id, current.kind === "resize" ? { repeatCount: result.clip.repeatCount }
      : { trackId: result.clip.trackId, startBar: result.clip.startBar });
    queueMicrotask(() => Array.from(surface.current?.querySelectorAll<HTMLButtonElement>("button[data-clip-id]") ?? [])
      .find((button) => button.dataset.clipId === clipId)?.focus({ preventScroll: true }));
  }

  const pattern = project.patterns.find((item) => item.id === preview?.clip.patternId);
  const track = project.tracks.find((item) => item.id === preview?.clip.trackId);
  return <div ref={surface} className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_410px] overflow-hidden"
    onPointerDown={start} onPointerMove={(event) => {
      if (event.pointerId === drag.current?.pointerId) move(event.clientX, event.clientY);
    }} onPointerUp={finish}
    onPointerCancel={(event) => { if (event.pointerId === drag.current?.pointerId) cancel(); }}
    onLostPointerCapture={(event) => { if (event.pointerId === drag.current?.pointerId) cancel(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); return; }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-clip-id], button[data-resize-clip-id]") : null;
      const clipId = button?.dataset.clipId ?? button?.dataset.resizeClipId;
      if (clipId) { event.preventDefault(); deleteClip(clipId); }
    }}
    onScrollCapture={() => { if (drag.current) move(drag.current.clientX, drag.current.clientY); }}>
    {children}
    {preview?.lane?.isConnected && pattern && track && createPortal(
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[3] rounded-[3px] border-2"
        style={{ left: `${preview.clip.startBar / preview.bars * 100}%`, width: `calc(${pattern.lengthBars * preview.clip.repeatCount / preview.bars * 100}% - 2px)`,
          borderColor: preview.problem ? "#fb7185" : "#fff", background: `color-mix(in srgb, ${getTrackColor(track)} 40%, transparent)` }} />,
      preview.lane)}
    {(preview || message) && <p role={preview ? "status" : "alert"}
      className="pointer-events-none absolute bottom-2 left-[170px] z-10 max-w-lg rounded border border-white/20 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
      {preview ? preview.problem ?? `${pattern?.name} · ${track?.name} · bar ${preview.clip.startBar + 1} · ×${preview.clip.repeatCount}` : message}
    </p>}
  </div>;
}
