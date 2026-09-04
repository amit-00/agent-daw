"use client";

import { useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { SOUND_CATALOG } from "@/audio/catalog";
import { ARRANGEMENT_BUFFER_BARS } from "@/components/arrangement/Arrangement";
import { getTrackColor } from "@/data/studio-data";
import { PROJECT_CAPS, ProjectValidationError, validateOperation, type ArrangementClip, type Operation, type Project } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

function getPlacementProblem(project: Project, clip: ArrangementClip): string | null {
  const operation: Operation = project.arrangement.some((item) => item.id === clip.id)
    ? { type: "arrangement.update", clipId: clip.id, changes: {
        patternId: clip.patternId, trackId: clip.trackId, startBar: clip.startBar, repeatCount: clip.repeatCount,
      } }
    : { type: "arrangement.place", clip };
  try {
    validateOperation(project, operation, SOUND_CATALOG);
    return null;
  } catch (error) {
    if (error instanceof ProjectValidationError) return error.message;
    throw error;
  }
}

interface PlacementPreview {
  readonly clip: ArrangementClip;
  readonly lane: HTMLElement | null;
  readonly problem: string | null;
  readonly bars: number;
}

interface PlacementDrag {
  readonly kind: "move" | "resize";
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
  scrollFrame: number | null;
}

export function ArrangementGestures({ children, onPreviewEndBar = () => undefined }: Readonly<{
  children: ReactNode; onPreviewEndBar?: (endBar: number | null) => void;
}>): ReactElement {
  const { project, updateClip, deleteClip, selectClip } = useStudioStore((state) => state);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<PlacementDrag | null>(null);
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function clipAreaLeft(current: PlacementDrag): number {
    return current.scroller.querySelector<HTMLElement>("[data-track-column]")!.getBoundingClientRect().right;
  }

  function candidateAt(current: PlacementDrag, clientX: number, clientY: number): PlacementPreview {
    const lanes = Array.from(current.scroller.querySelectorAll<HTMLElement>("[data-track-id]"));
    const source = lanes.find((lane) => lane.dataset.trackId === current.clip.trackId);
    const viewport = current.scroller.getBoundingClientRect();
    const lane = current.kind === "resize" ? source : lanes.find((item) => {
      const rect = item.getBoundingClientRect();
      return clientX >= Math.max(rect.left, clipAreaLeft(current)) &&
        clientY >= Math.max(rect.top, viewport.top) && clientY < Math.min(rect.bottom, viewport.bottom);
    });
    if (!lane) return { clip: current.clip, lane: null, bars: current.bars,
      problem: "Drop inside a track lane. Use clip settings for an exact placement." };
    const rect = lane.getBoundingClientRect();
    const deltaBars = (clientX - current.startX + current.laneLeft - rect.left) / current.pixelsPerBar;
    const lastStartBar = PROJECT_CAPS.maxArrangementBars - current.lengthBars * current.clip.repeatCount;
    const clip: ArrangementClip = { ...current.clip, trackId: lane.dataset.trackId!,
      startBar: current.kind === "move" ? Math.max(0, Math.min(lastStartBar, current.clip.startBar + Math.round(deltaBars))) : current.clip.startBar,
      repeatCount: current.kind === "resize"
        ? Math.max(1, Math.min(64, Math.round(current.clip.repeatCount + deltaBars / current.lengthBars))) : current.clip.repeatCount };
    const endBar = clip.startBar + current.lengthBars * clip.repeatCount;
    const bars = Math.min(PROJECT_CAPS.maxArrangementBars, Math.max(current.bars, endBar + ARRANGEMENT_BUFFER_BARS));
    return { clip, lane, bars, problem: getPlacementProblem(project, clip) };
  }

  function show(current: PlacementDrag, result: PlacementPreview): void {
    current.preview = result;
    setPreview(result);
    onPreviewEndBar(result.lane ? result.clip.startBar + current.lengthBars * result.clip.repeatCount : null);
  }

  function scrollSpeed(current: PlacementDrag): number {
    const viewport = current.scroller.getBoundingClientRect();
    const rightStart = viewport.right - 48;
    const leftEdge = clipAreaLeft(current);
    const leftStart = leftEdge + 48;
    if (current.clientX > rightStart) return Math.ceil((current.clientX - rightStart) / 3);
    if (current.clientX < leftStart && current.clientX >= leftEdge) return -Math.ceil((leftStart - current.clientX) / 3);
    return 0;
  }

  function scheduleScroll(current: PlacementDrag): void {
    const speed = scrollSpeed(current);
    if (speed === 0) {
      if (current.scrollFrame !== null) cancelAnimationFrame(current.scrollFrame);
      current.scrollFrame = null;
      return;
    }
    if (current.scrollFrame !== null) return;
    current.scrollFrame = requestAnimationFrame(() => {
      current.scrollFrame = null;
      if (drag.current !== current) return;
      const next = Math.max(0, Math.min(current.scroller.scrollWidth - current.scroller.clientWidth,
        current.scroller.scrollLeft + scrollSpeed(current)));
      if (next !== current.scroller.scrollLeft) {
        current.scroller.scrollLeft = next;
        show(current, candidateAt(current, current.clientX, current.clientY));
      }
      scheduleScroll(current);
    });
  }

  function cancel(): void {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    onPreviewEndBar(null);
    if (current && current.scrollFrame !== null) cancelAnimationFrame(current.scrollFrame);
    if (current && surface.current?.hasPointerCapture(current.pointerId)) surface.current.releasePointerCapture(current.pointerId);
  }

  function start(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || drag.current || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-clip-id], button[data-resize-clip-id]");
    if (!button) return;
    const scroller = surface.current!.querySelector<HTMLElement>("[data-arrangement-scroll]")!;
    const bars = Number(scroller.querySelector<HTMLElement>("[data-bars]")!.dataset.bars);
    const clipId = button.dataset.clipId ?? button.dataset.resizeClipId;
    const clip = clipId ? project.arrangement.find((item) => item.id === clipId) : undefined;
    if (!clip) return;
    const pattern = project.patterns.find((item) => item.id === clip.patternId);
    if (!pattern) return;
    const lane = Array.from(scroller.querySelectorAll<HTMLElement>("[data-track-id]"))
      .find((item) => item.dataset.trackId === clip.trackId);
    selectClip(clip.id);
    setMessage(null);
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    event.preventDefault();
    button.focus({ preventScroll: true });
    surface.current!.setPointerCapture(event.pointerId);
    drag.current = { kind: button.dataset.resizeClipId ? "resize" : "move", clip,
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, laneLeft: rect.left,
      pixelsPerBar: rect.width / bars, lengthBars: pattern.lengthBars, bars, scroller, preview: null, scrollFrame: null };
  }

  function move(clientX: number, clientY: number): void {
    const current = drag.current;
    if (!current) return;
    current.clientX = clientX;
    current.clientY = clientY;
    show(current, candidateAt(current, clientX, clientY));
    scheduleScroll(current);
  }

  function finish(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const result = current.preview?.lane && !project.tracks.some((track) => track.id === current.preview!.clip.trackId)
      ? current.preview : candidateAt(current, event.clientX, event.clientY);
    cancel();
    if (!result.lane) { setMessage(result.problem); return; }
    const unchanged = current.clip.trackId === result.clip.trackId && current.clip.startBar === result.clip.startBar &&
      current.clip.repeatCount === result.clip.repeatCount;
    if (!unchanged) updateClip(current.clip.id, current.kind === "resize" ? { repeatCount: result.clip.repeatCount }
      : { trackId: result.clip.trackId, startBar: result.clip.startBar });
    queueMicrotask(() => Array.from(surface.current?.querySelectorAll<HTMLButtonElement>("button[data-clip-id]") ?? [])
      .find((button) => button.dataset.clipId === current.clip.id)?.focus({ preventScroll: true }));
  }

  const pattern = project.patterns.find((item) => item.id === preview?.clip.patternId);
  const track = project.tracks.find((item) => item.id === preview?.clip.trackId);
  return <div ref={surface} className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
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
