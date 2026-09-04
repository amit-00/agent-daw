"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

import { Mixer } from "@/components/editor/Mixer";
import { PatternEditor } from "@/components/editor/PatternEditor";
import { useStudioStore } from "@/stores/studio-provider";

const DEFAULT_HEIGHT = 410;
const MIN_EDITOR_HEIGHT = 180;
const MIN_ARRANGEMENT_HEIGHT = 160;
const KEYBOARD_RESIZE_STEP = 20;

interface ResizeGesture {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly maximumHeight: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function TrackEditor(): ReactElement {
  const editorTab = useStudioStore((state) => state.editorTab);
  const selectEditorTab = useStudioStore((state) => state.selectEditorTab);
  const pane = useRef<HTMLElement>(null);
  const resizeGesture = useRef<ResizeGesture | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [maxHeight, setMaxHeight] = useState(DEFAULT_HEIGHT);
  const [open, setOpen] = useState(true);

  function maximumHeight(): number {
    return Math.max(MIN_EDITOR_HEIGHT,
      (pane.current?.parentElement?.getBoundingClientRect().height ?? DEFAULT_HEIGHT + MIN_ARRANGEMENT_HEIGHT) - MIN_ARRANGEMENT_HEIGHT);
  }

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || resizeGesture.current) return;
    event.preventDefault();
    const maximum = maximumHeight();
    setMaxHeight(maximum);
    resizeGesture.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height, maximumHeight: maximum };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>): void {
    const current = resizeGesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    setHeight(clamp(current.startHeight + current.startY - event.clientY, MIN_EDITOR_HEIGHT, current.maximumHeight));
  }

  function finishResize(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerId !== resizeGesture.current?.pointerId) return;
    resizeGesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const maximum = maximumHeight();
    setMaxHeight(maximum);
    setHeight((current) => clamp(current + (event.key === "ArrowUp" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP),
      MIN_EDITOR_HEIGHT, maximum));
  }

  if (!open) return <div className="relative z-[3] h-0 overflow-visible">
    <button type="button" aria-label="Open track editor" onClick={() => setOpen(true)}
      className="absolute right-3 bottom-3 flex items-center gap-2 rounded-md border border-white/15 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-400 shadow-lg hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">
      <span aria-hidden="true">⌃</span> Track editor
    </button>
  </div>;

  return (
    <aside ref={pane} style={{ height }} className="relative z-[3] min-h-0 overflow-visible bg-[#0d0d10]" aria-label="Track editor">
      <div role="separator" aria-label="Resize track editor" aria-orientation="horizontal" aria-valuemin={MIN_EDITOR_HEIGHT}
        aria-valuemax={maxHeight} aria-valuenow={height} aria-valuetext={`${height} pixels`} tabIndex={0}
        onFocus={() => setMaxHeight(maximumHeight())}
        onPointerDown={startResize} onPointerMove={resize} onPointerUp={finishResize}
        onPointerCancel={finishResize} onLostPointerCapture={(event) => {
          if (event.pointerId === resizeGesture.current?.pointerId) resizeGesture.current = null;
        }} onKeyDown={resizeWithKeyboard}
        className="absolute inset-x-0 top-0 z-[4] h-[8px] touch-none cursor-row-resize bg-[#0d0d10] hover:bg-violet-300/20 focus-visible:bg-violet-300/20 focus-visible:outline-none" />
      <div className="absolute -top-8 right-0 z-[5] flex items-end gap-1" aria-label="Editor tabs">
        <button className={`relative h-8 rounded-t-md border-0 px-[9px] text-xs ${editorTab === "pattern" ? "z-[2] bg-[#0d0d10] text-zinc-300" : "z-[1] bg-zinc-900 text-zinc-600"}`} type="button" aria-pressed={editorTab === "pattern"} onClick={() => selectEditorTab("pattern")}>Pattern</button>
        <button className={`relative h-8 rounded-t-md border-0 px-[9px] text-xs ${editorTab === "mixer" ? "z-[2] bg-[#0d0d10] text-zinc-300" : "z-[1] bg-zinc-900 text-zinc-600"}`} type="button" aria-pressed={editorTab === "mixer"} onClick={() => selectEditorTab("mixer")}>Mixer</button>
        <button type="button" aria-label="Close track editor" onClick={() => setOpen(false)}
          className="relative z-[3] h-8 w-10 rounded-t-md border-0 bg-[#0d0d10] text-[17px] leading-none text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"><span aria-hidden="true" className="block -translate-y-0.5">⌄</span></button>
      </div>
      {editorTab === "pattern" ? <PatternEditor /> : <Mixer />}
    </aside>
  );
}
