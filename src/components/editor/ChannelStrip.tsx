"use client";

import { useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import { INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

interface MixerDraft {
  readonly source: number;
  readonly value: string;
}

export function MixerControl({ label, value, min, max, step, unit, onCommit }: Readonly<{
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onCommit: (value: number) => void;
}>): ReactElement {
  const activeDraft = useRef<MixerDraft | null>(null);
  const [draft, setDraft] = useState<MixerDraft | null>(null);
  const displayed = draft?.source === value ? draft.value : String(value);

  function change(next: string): void {
    const candidate = { source: value, value: next };
    activeDraft.current = candidate;
    setDraft(candidate);
  }

  function cancel(): void {
    activeDraft.current = null;
    setDraft(null);
  }

  function commit(): void {
    const candidate = activeDraft.current;
    cancel();
    if (candidate?.source === value) onCommit(candidate.value.trim() === "" ? NaN : Number(candidate.value));
  }

  function numberKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    else if (event.key === "Escape") { event.preventDefault(); cancel(); }
  }

  return <label className="col-span-full grid gap-1 text-[9px] text-zinc-500">
    <span className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1"><input aria-label={`${label} value`} type="number" min={min} max={max} step={step}
        value={displayed} onChange={(event) => change(event.target.value)} onKeyDown={numberKeyDown} onBlur={commit}
        className="w-12 bg-black/40 px-1 text-right font-mono text-zinc-400" />{unit}</span>
    </span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={displayed}
      onChange={(event) => change(event.target.value)} onPointerUp={commit} onPointerCancel={cancel} onKeyUp={commit}
      className="m-0 h-[3px] w-full [accent-color:#d4d4d8]" />
  </label>;
}

export function ChannelStrip({ track }: Readonly<{ track: Track }>): ReactElement {
  const { setTrackVolume, setTrackPan, toggleMute, toggleSolo } = useStudioStore((state) => state);
  return (
    <div role="group" aria-label={`${track.name} channel`} className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] border-r border-white/[0.055] px-5 pt-[11px] pb-[9px]">
      <span className="col-span-full overflow-hidden text-center text-[10px] text-ellipsis whitespace-nowrap text-zinc-400">{track.name}</span>
      <small className="col-span-full row-start-2 self-start text-center text-[9px] text-zinc-600">{INSTRUMENT_NAMES[track.instrumentId] ?? track.instrumentId}</small>
      <span className="col-span-full row-start-2 flex h-[142px] w-3 items-end gap-[3px] self-center justify-self-center" aria-hidden="true" title="Audio disconnected">
        <i className="h-full w-1 rounded-full bg-zinc-800/50" /><i className="h-full w-1 rounded-full bg-zinc-800/50" />
      </span>
      <div className="col-span-full row-start-3"><MixerControl label={`${track.name} volume`} value={track.volumeDb} min={-60} max={6} step={0.1} unit="dB" onCommit={(value) => setTrackVolume(track.id, value)} /></div>
      <div className="col-span-full row-start-4"><MixerControl label={`${track.name} pan`} value={track.pan} min={-1} max={1} step={0.01} unit="" onCommit={(value) => setTrackPan(track.id, value)} /></div>
      <div className="col-span-full row-start-5 grid grid-cols-2 gap-[3px]">
        <button type="button" onClick={() => toggleMute(track.id)} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} className={`rounded border border-white/10 text-[9px] ${track.muted ? "bg-rose-400/20 text-rose-100" : "bg-white/[0.025] text-zinc-600"}`}>M</button>
        <button type="button" onClick={() => toggleSolo(track.id)} aria-label={`${track.soloed ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.soloed} className={`rounded border border-white/10 text-[9px] ${track.soloed ? "bg-amber-300/15 text-amber-100" : "bg-white/[0.025] text-zinc-600"}`}>S</button>
      </div>
    </div>
  );
}
