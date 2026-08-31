"use client";

import type { ReactElement } from "react";

import { BASIC_DRUM_KIT } from "@/audio/catalog";
import { PatternSidebar } from "@/components/editor/PatternSidebar";
import { useStudioStore } from "@/stores/studio-provider";

export function PatternEditor(): ReactElement {
  const { project, selectedPatternId, selectedClipId } = useStudioStore((state) => state);
  const pattern = project.patterns.find((item) => item.id === selectedPatternId);
  const clip = project.arrangement.find((item) => item.id === selectedClipId);
  const track = project.tracks.find((item) => item.id === clip?.trackId);
  const uses = project.arrangement.filter((item) => item.patternId === pattern?.id).length;
  const pitches = pattern?.kind === "synth" ? [...new Set(pattern.events.map((note) => note.midiNote))].sort((a, b) => b - a) : [];
  const rows = pattern?.kind === "drum"
    ? BASIC_DRUM_KIT.sounds.map((sound) => ({ id: sound.id, label: sound.id[0]!.toUpperCase() + sound.id.slice(1) }))
    : pitches.map((pitch) => ({ id: String(pitch), label: String(pitch) }));
  const steps = (pattern?.lengthBars ?? 1) * 16;
  return (
    <div className="grid h-[calc(100%-42px)] grid-cols-[214px_minmax(0,1fr)]">
      <PatternSidebar />
      {pattern ? (
        <section className="flex min-h-0 min-w-0 flex-col px-4 py-3" aria-label={`Pattern editor for ${pattern.name}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong className="block text-xs text-zinc-200">{pattern.name}</strong>
              <small className="mt-1 block text-[10px] text-zinc-400">{pattern.lengthBars} bars · {pattern.events.length} {pattern.kind === "drum" ? "hits" : "notes"} · {uses === 0 ? "Unplaced" : `${uses} placements`}{track ? ` · On ${track.name}` : ""}</small>
            </div>
            <span className="text-[10px] text-zinc-500">1/16 · Note editing coming next</span>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto rounded border border-white/10 bg-black/50">
            {rows.length === 0 ? <p className="p-4 text-xs text-zinc-500">This pattern has no notes.</p> : (
              <div style={{ minWidth: 56 + steps * 24 }}>
                <div className="ml-14 grid h-6 text-[9px] text-zinc-500" style={{ gridTemplateColumns: `repeat(${steps},1fr)` }}>
                  {Array.from({ length: steps }, (_, index) => <span key={index} className="border-l border-white/5 text-center">{index + 1}</span>)}
                </div>
                {rows.map((row) => (
                  <div className="flex h-10 border-t border-white/5" key={row.id}>
                    <span className="sticky left-0 z-[1] grid w-14 shrink-0 place-items-center bg-zinc-950 text-[10px] text-zinc-400">{row.label}</span>
                    <div className="relative flex-1 bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)]" style={{ backgroundSize: `${100 / steps}% 100%` }}>
                      {pattern.kind === "drum"
                        ? pattern.events.filter((hit) => hit.soundId === row.id).map((hit) => <span key={hit.id} className="absolute inset-y-2 rounded bg-violet-400/70" style={{ left: `${hit.startStep / steps * 100}%`, width: `${100 / steps}%` }} />)
                        : pattern.events.filter((note) => String(note.midiNote) === row.id).map((note) => <span key={note.id} className="absolute inset-y-2 rounded bg-violet-400/70" style={{ left: `${note.startStep / steps * 100}%`, width: `${note.lengthSteps / steps * 100}%` }} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : <p className="p-6 text-xs text-zinc-500">Select a pattern to view its notes or hits.</p>}
    </div>
  );
}
