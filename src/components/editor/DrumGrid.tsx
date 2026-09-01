"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement } from "react";

import { BASIC_DRUM_KIT } from "@/audio/catalog";
import { getTrackColor } from "@/data/studio-data";
import type { DrumPattern } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

interface DrumCell {
  readonly soundId: string;
  readonly startStep: number;
  readonly active: boolean;
}

interface PaintStroke {
  readonly pointerId: number;
  readonly active: boolean;
  readonly cells: ReadonlyMap<string, DrumCell>;
}

const cellKey = (soundId: string, startStep: number): string => `${soundId}:${startStep}`;
const soundName = (soundId: string): string => soundId[0]!.toUpperCase() + soundId.slice(1);
const MIN_STEP_WIDTH = 24;

export function DrumGrid({ pattern }: Readonly<{ pattern: DrumPattern }>): ReactElement {
  const { project, setDrumCells } = useStudioStore((state) => state);
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<PaintStroke | null>(null);
  const [stroke, setStroke] = useState<PaintStroke | null>(null);
  const steps = pattern.lengthBars * 16;
  const trackId = project.arrangement.find((clip) => clip.patternId === pattern.id)?.trackId;
  const track = project.tracks.find((item) => item.id === trackId);
  const color = getTrackColor(track ?? pattern);

  function isActive(soundId: string, startStep: number): boolean {
    return pattern.events.some((hit) => hit.soundId === soundId && hit.startStep === startStep);
  }

  function cellAt(clientX: number, clientY: number): DrumCell | null {
    const rect = cells.current!.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const startStep = Math.floor((clientX - rect.left) / rect.width * steps);
    const sound = BASIC_DRUM_KIT.sounds[Math.floor((clientY - rect.top) / rect.height * BASIC_DRUM_KIT.sounds.length)];
    return sound ? { soundId: sound.id, startStep, active: strokeRef.current!.active } : null;
  }

  function visit(cell: DrumCell | null): void {
    const current = strokeRef.current;
    if (!current || !cell) return;
    const key = cellKey(cell.soundId, cell.startStep);
    if (current.cells.has(key)) return;
    const next = { ...current, cells: new Map(current.cells).set(key, cell) };
    strokeRef.current = next;
    setStroke(next);
  }

  function start(event: PointerEvent<HTMLButtonElement>, soundId: string, startStep: number): void {
    if (event.button !== 0 || strokeRef.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    grid.current!.setPointerCapture(event.pointerId);
    const active = !isActive(soundId, startStep);
    const cell = { soundId, startStep, active };
    const next = { pointerId: event.pointerId, active, cells: new Map([[cellKey(soundId, startStep), cell]]) };
    strokeRef.current = next;
    setStroke(next);
  }

  function cancel(): void {
    const current = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (current && grid.current?.hasPointerCapture(current.pointerId)) grid.current.releasePointerCapture(current.pointerId);
  }

  function finish(event: PointerEvent<HTMLDivElement>): void {
    const current = strokeRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const edits = [...current.cells.values()];
    cancel();
    setDrumCells(pattern.id, edits);
  }

  function activate(event: MouseEvent<HTMLButtonElement>, soundId: string, startStep: number): void {
    if (event.detail === 0) setDrumCells(pattern.id, [{ soundId, startStep, active: !isActive(soundId, startStep) }]);
  }

  function activateKey(event: KeyboardEvent<HTMLButtonElement>, soundId: string, startStep: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setDrumCells(pattern.id, [{ soundId, startStep, active: !isActive(soundId, startStep) }]);
  }

  return <section ref={grid} aria-label={`Drum grid for ${pattern.name}`}
    className="grid h-full min-h-[160px] grid-cols-[38px_1fr] grid-rows-[20px_1fr] touch-none"
    style={{ minWidth: 38 + steps * MIN_STEP_WIDTH }}
    onPointerMove={(event) => { if (event.pointerId === strokeRef.current?.pointerId) visit(cellAt(event.clientX, event.clientY)); }}
    onPointerUp={finish}
    onPointerCancel={(event) => { if (event.pointerId === strokeRef.current?.pointerId) cancel(); }}
    onLostPointerCapture={(event) => { if (event.pointerId === strokeRef.current?.pointerId) cancel(); }}
    onKeyDown={(event) => { if (event.key === "Escape" && strokeRef.current) { event.preventDefault(); cancel(); } }}>
    <div className="col-start-2 grid border-b border-white/10 bg-white/[0.025]"
      style={{ gridTemplateColumns: `repeat(${steps},minmax(${MIN_STEP_WIDTH}px,1fr))` }}>
      {Array.from({ length: steps }, (_, index) => <span key={index}
        className="grid place-items-center border-l border-white/[0.04] font-mono text-[9px] text-zinc-600">{index + 1}</span>)}
    </div>
    <div className="sticky left-0 z-[1] row-start-2 grid border-r border-white/10 bg-zinc-950"
      style={{ gridTemplateRows: `repeat(${BASIC_DRUM_KIT.sounds.length},1fr)` }}>
      {BASIC_DRUM_KIT.sounds.map((sound) => <span key={sound.id}
        className="grid place-items-center border-b border-white/[0.045] font-mono text-[9px] text-zinc-500">{soundName(sound.id)}</span>)}
    </div>
    <div ref={cells} data-drum-cells className="col-start-2 row-start-2 grid"
      style={{ gridTemplateColumns: `repeat(${steps},minmax(${MIN_STEP_WIDTH}px,1fr))`, gridTemplateRows: `repeat(${BASIC_DRUM_KIT.sounds.length},1fr)` }}>
      {BASIC_DRUM_KIT.sounds.flatMap((sound) => Array.from({ length: steps }, (_, startStep) => {
        const preview = stroke?.cells.get(cellKey(sound.id, startStep));
        const active = preview?.active ?? isActive(sound.id, startStep);
        return <button key={`${sound.id}:${startStep}`} type="button" aria-pressed={active}
          aria-label={`${active ? "Remove" : "Add"} ${soundName(sound.id)} at step ${startStep + 1}`}
          data-sound-id={sound.id} data-start-step={startStep}
          onPointerDown={(event) => start(event, sound.id, startStep)}
          onClick={(event) => activate(event, sound.id, startStep)}
          onKeyDown={(event) => activateKey(event, sound.id, startStep)}
          className="relative border-r border-b border-white/[0.04] bg-transparent p-0 focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-violet-300">
          {active && <span className="absolute inset-1/4 rounded-[3px]" style={{ background: `color-mix(in srgb, ${color} 78%, transparent)` }} />}
        </button>;
      }))}
    </div>
  </section>;
}
