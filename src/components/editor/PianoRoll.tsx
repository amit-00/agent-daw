"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from "react";

import { getTrackColor } from "@/data/studio-data";
import type { SynthNote, SynthPattern } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

const NOTE_NAMES: readonly string[] = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const PITCHES = Array.from({ length: 73 }, (_, index) => 96 - index);
const MIN_STEP_WIDTH = 24;
const PITCH_HEIGHT = 18;
const DRAG_THRESHOLD = 3;

interface NotePreview {
  readonly notes: readonly SynthNote[];
  readonly replacesOriginals: boolean;
}

interface TransformGesture {
  readonly kind: "move" | "resize-left" | "resize-right";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly originals: readonly SynthNote[];
  readonly duplicate: boolean;
  duplicateStarted: boolean;
  stepDelta: number;
  pitchDelta: number;
  preview: readonly SynthNote[];
}

interface MarqueeGesture {
  readonly kind: "marquee";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly previousSelectedIds: readonly string[];
  dragged: boolean;
}

type NoteGesture = TransformGesture | MarqueeGesture;

interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
const pitchName = (midiNote: number): string => `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
const noteLabel = (note: SynthNote): string =>
  `Select ${pitchName(note.midiNote)} at step ${note.startStep + 1} for ${note.lengthSteps} ${note.lengthSteps === 1 ? "step" : "steps"}`;
const positionLabel = (step: number): string =>
  `Bar ${Math.floor(step / 16) + 1} · Beat ${Math.floor((step % 16) / 4) + 1} · Step ${(step % 4) + 1}`;
const durationLabel = (length: number): string => ({
  1: "1/16 note", 2: "1/8 note", 3: "3/16 note", 4: "1/4 note", 6: "Dotted 1/4",
  8: "1/2 note", 12: "Dotted 1/2", 16: "Whole note",
})[length] ?? `${length} steps`;

function moveNotes(notes: readonly SynthNote[], stepDelta: number, pitchDelta: number, steps: number): {
  readonly notes: readonly SynthNote[]; readonly stepDelta: number; readonly pitchDelta: number;
} {
  const boundedStep = clamp(stepDelta, -Math.min(...notes.map((note) => note.startStep)),
    steps - Math.max(...notes.map((note) => note.startStep + note.lengthSteps)));
  const boundedPitch = clamp(pitchDelta, 24 - Math.min(...notes.map((note) => note.midiNote)),
    96 - Math.max(...notes.map((note) => note.midiNote)));
  return { stepDelta: boundedStep, pitchDelta: boundedPitch,
    notes: notes.map((note) => ({ ...note, startStep: note.startStep + boundedStep, midiNote: note.midiNote + boundedPitch })) };
}

function resizeNotes(notes: readonly SynthNote[], delta: number, side: "left" | "right", steps: number): {
  readonly notes: readonly SynthNote[]; readonly stepDelta: number;
} {
  const bounded = side === "right"
    ? clamp(delta, Math.max(...notes.map((note) => 1 - note.lengthSteps)),
      Math.min(...notes.map((note) => steps - note.startStep - note.lengthSteps)))
    : clamp(delta, Math.max(...notes.map((note) => -note.startStep)),
      Math.min(...notes.map((note) => note.lengthSteps - 1)));
  return { stepDelta: bounded, notes: notes.map((note) => side === "right"
    ? { ...note, lengthSteps: note.lengthSteps + bounded }
    : { ...note, startStep: note.startStep + bounded, lengthSteps: note.lengthSteps - bounded }) };
}

export function PianoRoll({ pattern }: Readonly<{ pattern: SynthPattern }>): ReactElement {
  const { project, addSynthNote, updateSynthNotes, duplicateSynthNotes, deleteSynthNotes } = useStudioStore((state) => state);
  const cells = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<NoteGesture | null>(null);
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const steps = pattern.lengthBars * 16;
  const currentSelectedIds = selectedIds.filter((id) => pattern.events.some((note) => note.id === id));
  const selected = pattern.events.filter((note) => currentSelectedIds.includes(note.id));
  const inspected = preview?.notes ?? selected;
  const previewById = new Map(preview?.notes.map((note) => [note.id, note]));
  const displayed = preview?.replacesOriginals
    ? pattern.events.map((note) => previewById.get(note.id) ?? note)
    : [...pattern.events, ...(preview?.notes.map((note) => ({ ...note, id: `preview:${note.id}` })) ?? [])];
  const trackId = project.arrangement.find((clip) => clip.patternId === pattern.id)?.trackId;
  const track = project.tracks.find((item) => item.id === trackId);
  const color = getTrackColor(track ?? pattern);

  function clearGesture(): NoteGesture | null {
    const current = gestureRef.current;
    gestureRef.current = null;
    setPreview(null);
    setMarquee(null);
    if (current && cells.current?.hasPointerCapture(current.pointerId)) cells.current.releasePointerCapture(current.pointerId);
    return current;
  }

  function cancelGesture(): void {
    const current = clearGesture();
    if (current?.kind === "marquee") setSelectedIds(current.previousSelectedIds);
  }

  function begin(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || gestureRef.current) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const noteElement = target?.closest<HTMLElement>("[data-note-id]");
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    if (!noteElement) {
      const rect = event.currentTarget.getBoundingClientRect();
      gestureRef.current = { kind: "marquee", pointerId: event.pointerId,
        startX: clamp(event.clientX - rect.left, 0, rect.width), startY: clamp(event.clientY - rect.top, 0, rect.height),
        previousSelectedIds: currentSelectedIds, dragged: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const noteId = noteElement.dataset.noteId!;
    const alreadySelected = currentSelectedIds.includes(noteId);
    const ids = event.shiftKey
      ? alreadySelected ? currentSelectedIds.filter((id) => id !== noteId) : [...currentSelectedIds, noteId]
      : alreadySelected ? currentSelectedIds : [noteId];
    setSelectedIds(ids);
    noteElement.focus({ preventScroll: true });
    if (!ids.includes(noteId)) return;
    const originals = pattern.events.filter((note) => ids.includes(note.id));
    const side = target?.closest<HTMLElement>("[data-resize-side]")?.dataset.resizeSide;
    const kind = side === "left" ? "resize-left" : side === "right" ? "resize-right" : "move";
    gestureRef.current = { kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      originals, duplicate: event.altKey && kind === "move", duplicateStarted: false,
      stepDelta: 0, pitchDelta: 0, preview: originals };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>): void {
    const current = gestureRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (current.kind === "marquee") {
      const currentX = clamp(event.clientX - rect.left, 0, rect.width);
      const currentY = clamp(event.clientY - rect.top, 0, rect.height);
      const left = Math.min(current.startX, currentX);
      const top = Math.min(current.startY, currentY);
      const right = Math.max(current.startX, currentX);
      const bottom = Math.max(current.startY, currentY);
      if (right - left < DRAG_THRESHOLD && bottom - top < DRAG_THRESHOLD) return;
      current.dragged = true;
      const stepWidth = rect.width / steps;
      const pitchHeight = rect.height / PITCHES.length;
      setSelectedIds(pattern.events.filter((note) => {
        const noteLeft = note.startStep * stepWidth;
        const noteRight = (note.startStep + note.lengthSteps) * stepWidth;
        const noteTop = (96 - note.midiNote) * pitchHeight;
        return noteLeft < right && noteRight > left && noteTop < bottom && noteTop + pitchHeight > top;
      }).map((note) => note.id));
      setMarquee({ left, top, width: right - left, height: bottom - top });
      return;
    }

    const rawX = event.clientX - current.startX;
    const rawY = current.startY - event.clientY;
    if (current.duplicate && !current.duplicateStarted) {
      if (Math.abs(rawX) < DRAG_THRESHOLD && Math.abs(rawY) < DRAG_THRESHOLD) return;
      current.duplicateStarted = true;
    }
    const rawStepDelta = Math.round(rawX / (rect.width / steps));
    if (current.kind === "move") {
      const result = moveNotes(current.originals, rawStepDelta, Math.round(rawY / (rect.height / PITCHES.length)), steps);
      current.preview = result.notes;
      current.stepDelta = result.stepDelta;
      current.pitchDelta = result.pitchDelta;
    } else {
      const result = resizeNotes(current.originals, rawStepDelta, current.kind === "resize-left" ? "left" : "right", steps);
      current.preview = result.notes;
      current.stepDelta = result.stepDelta;
    }
    setPreview({ notes: current.preview, replacesOriginals: !current.duplicateStarted });
  }

  function finish(event: PointerEvent<HTMLDivElement>): void {
    const current = gestureRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.kind === "marquee") {
      const dragged = current.dragged;
      clearGesture();
      if (!dragged) setSelectedIds([]);
      return;
    }
    clearGesture();
    if (current.duplicateStarted) {
      const ids = duplicateSynthNotes(pattern.id, current.originals.map((note) => note.id), current.stepDelta, current.pitchDelta);
      if (ids.length > 0) setSelectedIds(ids);
    } else if (current.stepDelta !== 0 || current.pitchDelta !== 0) {
      updateSynthNotes(pattern.id, current.preview.map((note) => ({ noteId: note.id, changes: {
        midiNote: note.midiNote, startStep: note.startStep, lengthSteps: note.lengthSteps,
      } })));
    }
  }

  function doubleClick(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target : null;
    const noteId = target?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
    if (noteId && pattern.events.some((note) => note.id === noteId)) {
      deleteSynthNotes(pattern.id, [noteId]);
      setSelectedIds(currentSelectedIds.filter((id) => id !== noteId));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const startStep = Math.floor((event.clientX - rect.left) / (rect.width / steps));
    const pitchIndex = Math.floor((event.clientY - rect.top) / (rect.height / PITCHES.length));
    if (startStep < 0 || startStep >= steps || pitchIndex < 0 || pitchIndex >= PITCHES.length) return;
    const id = addSynthNote(pattern.id, PITCHES[pitchIndex]!, startStep, 1);
    if (id) setSelectedIds([id]);
  }

  function updateSelection(notes: readonly SynthNote[]): void {
    updateSynthNotes(pattern.id, notes.map((note) => ({ noteId: note.id, changes: {
      midiNote: note.midiNote, startStep: note.startStep, lengthSteps: note.lengthSteps,
    } })));
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelGesture();
      setSelectedIds([]);
      return;
    }
    if (currentSelectedIds.length === 0) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSynthNotes(pattern.id, currentSelectedIds);
      setSelectedIds([]);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      const start = Math.min(...selected.map((note) => note.startStep));
      const end = Math.max(...selected.map((note) => note.startStep + note.lengthSteps));
      const ids = duplicateSynthNotes(pattern.id, currentSelectedIds, end - start, 0);
      if (ids.length > 0) setSelectedIds(ids);
      return;
    }
    const movement: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const delta = movement[event.key];
    if (delta) {
      event.preventDefault();
      updateSelection(moveNotes(selected, delta[0], delta[1], steps).notes);
    }
  }

  const pitches = new Set(inspected.map((note) => note.midiNote));
  const lengths = new Set(inspected.map((note) => note.lengthSteps));
  const starts = inspected.map((note) => note.startStep);
  const position = starts.length === 0 ? "" : starts.every((start) => start === starts[0])
    ? positionLabel(starts[0]!)
    : `${positionLabel(Math.min(...starts))} – ${positionLabel(Math.max(...starts))}`;

  return <section aria-label={`Piano roll for ${pattern.name}`}
    className="flex h-full min-h-0 flex-col touch-none"
    onKeyDown={handleKeyboard}>
    <div data-note-inspector className="z-20 flex h-9 min-w-max shrink-0 items-center border-b border-white/10 bg-zinc-950 px-2 text-[9px] text-zinc-500">
      {inspected.length > 0 && <div role="status" aria-label="Selected note inspector" className="flex items-center gap-2">
        <strong className="min-w-24 text-zinc-300">{inspected.length} {inspected.length === 1 ? "note" : "notes"} selected</strong>
        <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1"><b className="mr-1 font-medium text-zinc-600">Pitch</b>{" "}{pitches.size === 1 ? pitchName(inspected[0]!.midiNote) : "Mixed"}</span>
        <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1"><b className="mr-1 font-medium text-zinc-600">Position</b>{" "}{position}</span>
        <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1"><b className="mr-1 font-medium text-zinc-600">Duration</b>{" "}{lengths.size === 1 ? durationLabel(inspected[0]!.lengthSteps) : "Mixed"}</span>
      </div>}
    </div>
    <div data-piano-scroll className="min-h-0 flex-1 overflow-auto">
      <div className="grid grid-cols-[38px_1fr] grid-rows-[20px_1fr]"
        style={{ minWidth: 38 + steps * MIN_STEP_WIDTH, height: 20 + PITCHES.length * PITCH_HEIGHT }}>
        <div className="col-start-2 grid border-b border-white/10 bg-white/[0.025]"
          style={{ gridTemplateColumns: `repeat(${steps},minmax(${MIN_STEP_WIDTH}px,1fr))` }}>
          {Array.from({ length: steps }, (_, index) => <span key={index}
            className="grid place-items-center border-l border-white/[0.04] font-mono text-[9px] text-zinc-600">{index + 1}</span>)}
        </div>
        <div className="sticky left-0 z-10 row-start-2 grid border-r border-white/10 bg-zinc-950"
          style={{ gridTemplateRows: `repeat(${PITCHES.length},${PITCH_HEIGHT}px)` }}>
          {PITCHES.map((pitch) => <span key={pitch}
            className="grid place-items-center border-b border-white/[0.045] font-mono text-[9px] text-zinc-500">{pitchName(pitch)}</span>)}
        </div>
        <div ref={cells} data-piano-cells role="group" tabIndex={0} aria-label={`Note grid, ${steps} steps`}
          onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={(event) => { if (event.pointerId === gestureRef.current?.pointerId) cancelGesture(); }}
          onLostPointerCapture={(event) => { if (event.pointerId === gestureRef.current?.pointerId) cancelGesture(); }}
          onDoubleClick={doubleClick}
          className="relative col-start-2 row-start-2 grid focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-300"
          style={{ gridTemplateColumns: `repeat(${steps},minmax(${MIN_STEP_WIDTH}px,1fr))`, gridTemplateRows: `repeat(${PITCHES.length},${PITCH_HEIGHT}px)`,
            backgroundImage: "linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.04) 1px, transparent 1px)",
            backgroundSize: `${100 / steps}% 100%, 100% ${PITCH_HEIGHT}px` }}>
          {displayed.map((note) => {
            const previewCopy = note.id.startsWith("preview:");
            const sourceId = previewCopy ? note.id.slice("preview:".length) : note.id;
            const duplicatePreview = preview !== null && !preview.replacesOriginals;
            const row = 96 - note.midiNote + 1;
            const selectedNote = previewCopy || (!duplicatePreview && currentSelectedIds.includes(sourceId));
            return <button key={note.id} type="button" data-note-id={sourceId} aria-label={noteLabel(note)} aria-pressed={selectedNote}
              className={`relative z-[1] m-[2px] cursor-grab rounded-[3px] border p-0 focus-visible:z-[3] focus-visible:outline-2 focus-visible:outline-violet-300 ${selectedNote ? "border-white/90 outline outline-1 outline-white/70" : "border-white/20"}`}
              style={{ gridColumn: `${note.startStep + 1} / span ${note.lengthSteps}`, gridRow: String(row),
                background: `color-mix(in srgb, ${color} ${selectedNote ? 92 : 78}%, transparent)` }}>
              <span data-resize-side="left" aria-hidden="true" className="absolute inset-y-[-1px] left-[-1px] w-[7px] cursor-ew-resize" />
              <span data-resize-side="right" aria-hidden="true" className="absolute inset-y-[-1px] right-[-1px] w-[7px] cursor-ew-resize" />
            </button>;
          })}
          {marquee && <div data-testid="note-marquee" aria-hidden="true" className="pointer-events-none absolute z-[8] border border-white/80 bg-white/10"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}
        </div>
      </div>
    </div>
  </section>;
}
