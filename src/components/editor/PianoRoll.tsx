"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from "react";

import { getTrackColor } from "@/data/studio-data";
import type { SynthNote, SynthPattern } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

const NOTE_NAMES: readonly string[] = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const PITCHES = Array.from({ length: 73 }, (_, index) => 96 - index);
const MIN_STEP_WIDTH = 24;
const PITCH_HEIGHT = 18;

interface NoteGesture {
  readonly pointerId: number;
  readonly kind: "move" | "resize";
  readonly startX: number;
  readonly startY: number;
  readonly notes: readonly SynthNote[];
  readonly preview: ReadonlyMap<string, SynthNote>;
}

interface NoteDraft {
  readonly source: string;
  readonly pitch: string;
  readonly start: string;
  readonly length: string;
}

const pitchName = (midiNote: number): string => `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
const noteLabel = (note: SynthNote): string =>
  `Select ${pitchName(note.midiNote)} at step ${note.startStep + 1} for ${note.lengthSteps} ${note.lengthSteps === 1 ? "step" : "steps"}`;

export function PianoRoll({ pattern }: Readonly<{ pattern: SynthPattern }>): ReactElement {
  const { project, addSynthNote, updateSynthNotes, duplicateSynthNotes, deleteSynthNotes } = useStudioStore((state) => state);
  const roll = useRef<HTMLElement>(null);
  const cells = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<NoteGesture | null>(null);
  const [preview, setPreview] = useState<ReadonlyMap<string, SynthNote> | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [duplicateOffset, setDuplicateOffset] = useState("1");
  const steps = pattern.lengthBars * 16;
  const currentSelectedIds = selectedIds.filter((id) => pattern.events.some((note) => note.id === id));
  const selected = pattern.events.filter((note) => currentSelectedIds.includes(note.id));
  const primary = selected[0];
  const draftSource = primary ? `${primary.id}:${primary.midiNote}:${primary.startStep}:${primary.lengthSteps}` : "new";
  const currentDraft = draft?.source === draftSource ? draft : {
    source: draftSource, pitch: primary ? String(primary.midiNote) : "60",
    start: primary ? String(primary.startStep + 1) : "1", length: primary ? String(primary.lengthSteps) : "1",
  };
  const displayed = pattern.events.map((note) => preview?.get(note.id) ?? note);
  const trackId = project.arrangement.find((clip) => clip.patternId === pattern.id)?.trackId;
  const track = project.tracks.find((item) => item.id === trackId);
  const color = getTrackColor(track ?? pattern);

  function releaseCapture(pointerId: number): void {
    if (roll.current?.hasPointerCapture(pointerId)) roll.current.releasePointerCapture(pointerId);
  }

  function cancel(): void {
    const current = gestureRef.current;
    gestureRef.current = null;
    setPreview(null);
    if (current) releaseCapture(current.pointerId);
  }

  function beginMove(event: PointerEvent<HTMLButtonElement>, note: SynthNote): void {
    if (event.button !== 0 || gestureRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const alreadySelected = currentSelectedIds.includes(note.id);
    const ids = event.shiftKey
      ? alreadySelected ? currentSelectedIds.filter((id) => id !== note.id) : [...currentSelectedIds, note.id]
      : alreadySelected ? currentSelectedIds : [note.id];
    setSelectedIds(ids);
    if (event.shiftKey && alreadySelected) return;
    const notes = pattern.events.filter((item) => ids.includes(item.id));
    const next = { pointerId: event.pointerId, kind: "move" as const, startX: event.clientX, startY: event.clientY,
      notes, preview: new Map(notes.map((item) => [item.id, item])) };
    gestureRef.current = next;
    setPreview(next.preview);
    roll.current!.setPointerCapture(event.pointerId);
  }

  function beginResize(event: PointerEvent<HTMLButtonElement>, note: SynthNote): void {
    if (event.button !== 0 || gestureRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    setSelectedIds([note.id]);
    const next = { pointerId: event.pointerId, kind: "resize" as const, startX: event.clientX, startY: event.clientY,
      notes: [note], preview: new Map([[note.id, note]]) };
    gestureRef.current = next;
    setPreview(next.preview);
    roll.current!.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>): void {
    const current = gestureRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const rect = cells.current!.getBoundingClientRect();
    const stepDelta = Math.round((event.clientX - current.startX) / (rect.width / steps));
    const pitchDelta = Math.round((event.clientY - current.startY) / (rect.height / PITCHES.length));
    const notes = current.notes.map((note): SynthNote => current.kind === "move"
      ? { ...note, startStep: note.startStep + stepDelta, midiNote: note.midiNote - pitchDelta }
      : { ...note, lengthSteps: note.lengthSteps + stepDelta });
    const next = { ...current, preview: new Map(notes.map((note) => [note.id, note])) };
    gestureRef.current = next;
    setPreview(next.preview);
  }

  function finish(event: PointerEvent<HTMLElement>): void {
    const current = gestureRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const notes = [...current.preview.values()];
    cancel();
    updateSynthNotes(pattern.id, notes.map((note) => ({ noteId: note.id, changes: {
      midiNote: note.midiNote, startStep: note.startStep, lengthSteps: note.lengthSteps,
    } })));
  }

  function applyDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!primary) {
      const id = addSynthNote(pattern.id, Number(currentDraft.pitch), Number(currentDraft.start) - 1, Number(currentDraft.length));
      if (id) setSelectedIds([id]);
      return;
    }
    updateSynthNotes(pattern.id, [{ noteId: primary.id, changes: {
      midiNote: Number(currentDraft.pitch), startStep: Number(currentDraft.start) - 1, lengthSteps: Number(currentDraft.length),
    } }]);
  }

  function addAtCell(event: MouseEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startStep = Math.floor((event.clientX - rect.left) / (rect.width / steps));
    const pitchIndex = Math.floor((event.clientY - rect.top) / (rect.height / PITCHES.length));
    if (startStep < 0 || startStep >= steps || pitchIndex < 0 || pitchIndex >= PITCHES.length) return;
    const id = addSynthNote(pattern.id, PITCHES[pitchIndex]!, startStep, 1);
    if (id) setSelectedIds([id]);
  }

  function handleKeyboard(event: KeyboardEvent<HTMLElement>): void {
    if (event.target instanceof HTMLInputElement) return;
    if ((event.key === "Delete" || event.key === "Backspace") && currentSelectedIds.length > 0) {
      event.preventDefault();
      deleteSynthNotes(pattern.id, currentSelectedIds);
      setSelectedIds([]);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && currentSelectedIds.length > 0) {
      event.preventDefault();
      duplicateSynthNotes(pattern.id, currentSelectedIds, Number(duplicateOffset));
    }
  }

  return <section ref={roll} aria-label={`Piano roll for ${pattern.name}`}
    className="flex h-full min-h-0 flex-col touch-none"
    onPointerMove={move}
    onPointerUp={finish}
    onPointerCancel={(event) => { if (event.pointerId === gestureRef.current?.pointerId) cancel(); }}
    onLostPointerCapture={(event) => { if (event.pointerId === gestureRef.current?.pointerId) cancel(); }}
    onKeyDown={(event) => { if (event.key === "Escape" && gestureRef.current) { event.preventDefault(); cancel(); } else handleKeyboard(event); }}>
    <form onSubmit={applyDraft} className="z-20 flex h-9 min-w-max shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950 px-2 text-[9px] text-zinc-500">
      <label>Pitch <input aria-label="Pitch" type="number" min="24" max="96" value={currentDraft.pitch}
        onChange={(event) => setDraft({ ...currentDraft, pitch: event.target.value })} className="ml-1 w-12 bg-black/40 px-1 text-zinc-300" /></label>
      <label>Start <input aria-label="Start step" type="number" min="1" max={steps} value={currentDraft.start}
        onChange={(event) => setDraft({ ...currentDraft, start: event.target.value })} className="ml-1 w-12 bg-black/40 px-1 text-zinc-300" /></label>
      <label>Length <input aria-label="Length" type="number" min="1" max={steps} value={currentDraft.length}
        onChange={(event) => setDraft({ ...currentDraft, length: event.target.value })} className="ml-1 w-12 bg-black/40 px-1 text-zinc-300" /></label>
      <button type="submit" className="rounded border border-white/10 px-2 py-1">{primary ? "Apply note" : "Add note"}</button>
      <label>Offset <input aria-label="Duplicate offset" type="number" value={duplicateOffset}
        onChange={(event) => setDuplicateOffset(event.target.value)} className="ml-1 w-12 bg-black/40 px-1 text-zinc-300" /></label>
      <button type="button" disabled={currentSelectedIds.length === 0} onClick={() => duplicateSynthNotes(pattern.id, currentSelectedIds, Number(duplicateOffset))}
        className="rounded border border-white/10 px-2 py-1 disabled:opacity-35">Duplicate selected</button>
      <button type="button" disabled={currentSelectedIds.length === 0} onClick={() => { deleteSynthNotes(pattern.id, currentSelectedIds); setSelectedIds([]); }}
        className="rounded border border-white/10 px-2 py-1 disabled:opacity-35">Delete selected</button>
    </form>
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
        <div ref={cells} data-piano-cells role="group" aria-label={`Note grid, ${steps} steps`} onClick={addAtCell}
          className="col-start-2 row-start-2 grid"
          style={{ gridTemplateColumns: `repeat(${steps},minmax(${MIN_STEP_WIDTH}px,1fr))`, gridTemplateRows: `repeat(${PITCHES.length},${PITCH_HEIGHT}px)`,
            backgroundImage: "linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.04) 1px, transparent 1px)",
            backgroundSize: `${100 / steps}% 100%, 100% ${PITCH_HEIGHT}px` }}>
          {displayed.flatMap((note) => {
            const row = 96 - note.midiNote + 1;
            const placement = { gridColumn: `${note.startStep + 1} / span ${Math.max(1, note.lengthSteps)}`, gridRow: String(row) };
            return [
              <button key={note.id} type="button" aria-label={noteLabel(note)} aria-pressed={currentSelectedIds.includes(note.id)}
                onPointerDown={(event) => beginMove(event, note)}
                className="z-[1] m-[2px] rounded-[3px] border border-white/20 p-0 focus-visible:z-[3] focus-visible:outline-2 focus-visible:outline-violet-300"
                style={{ ...placement, background: `color-mix(in srgb, ${color} 78%, transparent)` }} />,
              <button key={`${note.id}:resize`} type="button" aria-label={`Resize ${pitchName(note.midiNote)} at step ${note.startStep + 1}`}
                onPointerDown={(event) => beginResize(event, note)}
                className="z-[2] w-1.5 cursor-ew-resize justify-self-end bg-white/30 p-0 focus-visible:z-[3] focus-visible:outline-2 focus-visible:outline-violet-300"
                style={placement} />,
            ];
          })}
        </div>
      </div>
    </div>
  </section>;
}
