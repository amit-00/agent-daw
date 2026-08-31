"use client";

import type { ReactElement } from "react";

import { BASIC_DRUM_KIT } from "@/audio/catalog";
import { PatternSidebar } from "@/components/editor/PatternSidebar";
import { getTrackColor } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-provider";

const NOTE_NAMES: readonly string[] = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function PatternEditor(): ReactElement {
  const { project, selectedPatternId, selectedClipId } = useStudioStore((state) => state);
  const pattern = project.patterns.find((item) => item.id === selectedPatternId);
  const clip = project.arrangement.find((item) => item.id === selectedClipId);
  const track = project.tracks.find((item) => item.id === clip?.trackId);
  const uses = project.arrangement.filter((item) => item.patternId === pattern?.id).length;
  const pitches = pattern?.kind === "synth" ? [...new Set(pattern.events.map((note) => note.midiNote))].sort((a, b) => b - a) : [];
  const rows = pattern?.kind === "drum"
    ? BASIC_DRUM_KIT.sounds.map((sound) => ({ id: sound.id, label: sound.id[0]!.toUpperCase() + sound.id.slice(1) }))
    : pitches.map((pitch) => ({ id: String(pitch), label: `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}` }));
  const steps = (pattern?.lengthBars ?? 1) * 16;
  const colorTrackId = track?.id ?? project.arrangement.find((item) => item.patternId === pattern?.id)?.trackId;
  const colorTrack = project.tracks.find((item) => item.id === colorTrackId);
  const color = getTrackColor(colorTrack ?? pattern ?? { id: "" });
  return (
    <div className="grid h-[calc(100%-42px)] grid-cols-[214px_minmax(0,1fr)]">
      <PatternSidebar />
      {pattern ? (
        <section className="flex min-h-0 min-w-0 flex-col px-4 pt-3.5 pb-4" aria-label={`Pattern editor for ${pattern.name}`}>
          <div className="flex min-h-11 items-start justify-between gap-3">
            <div>
              <small className="block text-[9px] font-semibold tracking-[0.12em] text-zinc-600">{track ? "SELECTED TRACK" : "SELECTED PATTERN"}</small>
              <strong className="mt-1 block text-[11px] font-semibold text-zinc-300">{track?.name ?? pattern.name}</strong>
              <em className="mt-[3px] block text-[10px] not-italic text-zinc-600">{pattern.name} · {pattern.lengthBars} bars · {pattern.events.length} {pattern.kind === "drum" ? "hits" : "notes"} · {uses === 0 ? "Unplaced" : `${uses} placements`}</em>
            </div>
            <div className="flex gap-[5px]" aria-label="Fixed grid settings">
              <span className="grid h-[27px] place-items-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-zinc-500">1 / 16</span>
              <span className="grid h-[27px] place-items-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-zinc-500">100%</span>
            </div>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-[7px] border border-white/10 bg-black/50" title="Pattern editing is not connected yet">
            {rows.length === 0 ? <p className="p-4 text-xs text-zinc-500">This pattern has no notes.</p> : (
              <div className="grid h-full min-h-[160px] grid-cols-[38px_1fr] grid-rows-[20px_1fr]" style={{ minWidth: 38 + steps * 24 }}>
                <div className="col-start-2 grid border-b border-white/10 bg-white/[0.025]" style={{ gridTemplateColumns: `repeat(${steps},1fr)` }}>
                  {Array.from({ length: steps }, (_, index) => <span key={index} className="grid place-items-center border-l border-white/[0.04] font-mono text-[9px] text-zinc-600">{index + 1}</span>)}
                </div>
                <div className="sticky left-0 z-[1] row-start-2 grid border-r border-white/10 bg-zinc-950" style={{ gridTemplateRows: `repeat(${rows.length},1fr)` }}>
                  {rows.map((row) => <span key={row.id} className="grid place-items-center border-b border-white/[0.045] font-mono text-[9px] text-zinc-500">{row.label}</span>)}
                </div>
                <div className="col-start-2 row-start-2 grid" style={{ gridTemplateRows: `repeat(${rows.length},1fr)` }}>
                  {rows.map((row) => (
                    <div key={row.id} className="relative border-b border-white/[0.04] bg-[linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)]" style={{ backgroundSize: `${400 / steps}% 100%, ${100 / steps}% 100%` }}>
                      {pattern.kind === "drum"
                        ? pattern.events.filter((hit) => hit.soundId === row.id).map((hit) => <span key={hit.id} className="absolute inset-y-1/4 rounded-[3px]" style={{ left: `${(hit.startStep + 0.12) / steps * 100}%`, width: `${0.76 / steps * 100}%`, background: `color-mix(in srgb, ${color} 78%, transparent)` }} />)
                        : pattern.events.filter((note) => String(note.midiNote) === row.id).map((note) => <span key={note.id} className="absolute inset-y-1/4 rounded-[3px]" style={{ left: `${note.startStep / steps * 100}%`, width: `${note.lengthSteps / steps * 100}%`, background: `color-mix(in srgb, ${color} 78%, transparent)` }} />)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      ) : <p className="p-6 text-xs text-zinc-500">Select a pattern to view its notes or hits.</p>}
    </div>
  );
}
