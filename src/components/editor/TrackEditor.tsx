"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

import { Mixer } from "@/components/editor/Mixer";
import { PatternEditor } from "@/components/editor/PatternEditor";
import { Icon } from "@/components/icons";
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
      className="absolute right-3 bottom-3 flex items-center gap-2 rounded-md border border-white/15 bg-zinc-950/95 px-3 py-2 text-[10px] text-zinc-400 shadow-lg hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">
      <span aria-hidden="true">⌃</span> Track editor
    </button>
  </div>;

  return (
    <aside ref={pane} style={{ height }} className="relative z-[3] min-h-0 overflow-hidden border-t border-white/15 bg-[#0d0d10]" aria-label="Track editor">
      <div role="separator" aria-label="Resize track editor" aria-orientation="horizontal" aria-valuemin={MIN_EDITOR_HEIGHT}
        aria-valuemax={maxHeight} aria-valuenow={height} aria-valuetext={`${height} pixels`} tabIndex={0}
        onFocus={() => setMaxHeight(maximumHeight())}
        onPointerDown={startResize} onPointerMove={resize} onPointerUp={finishResize}
        onPointerCancel={finishResize} onLostPointerCapture={(event) => {
          if (event.pointerId === resizeGesture.current?.pointerId) resizeGesture.current = null;
        }} onKeyDown={resizeWithKeyboard}
        className="absolute inset-x-0 top-0 z-[4] h-[8px] touch-none cursor-row-resize hover:bg-violet-300/20 focus-visible:bg-violet-300/20 focus-visible:outline-none" />
      <div className="relative z-[1] grid h-[42px] grid-cols-[1fr_auto_1fr] items-center border-b border-white/10 pr-[11px] pl-[15px]">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Icon name={editorTab === "pattern" ? "draw" : "mixer"} /> Track editor</span>
        <div className="flex rounded-md border border-white/10 bg-black/20 p-[3px]" aria-label="Editor tabs">
          <button className={`rounded border-0 px-[9px] py-1 text-[10px] ${editorTab === "pattern" ? "bg-white/[0.08] text-zinc-300" : "bg-transparent text-zinc-600"}`} type="button" aria-pressed={editorTab === "pattern"} onClick={() => selectEditorTab("pattern")}>Pattern</button>
          <button className={`rounded border-0 px-[9px] py-1 text-[10px] ${editorTab === "mixer" ? "bg-white/[0.08] text-zinc-300" : "bg-transparent text-zinc-600"}`} type="button" aria-pressed={editorTab === "mixer"} onClick={() => selectEditorTab("mixer")}>Mixer</button>
        </div>
        <button type="button" aria-label="Close track editor" onClick={() => setOpen(false)}
          className="h-6 w-6 justify-self-end rounded-md border-0 bg-transparent text-[17px] leading-none text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">×</button>
      </div>
      {editorTab === "pattern" ? <PatternEditor /> : <Mixer />}
    </aside>
  );
}
