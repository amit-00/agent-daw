"use client";

import type { ReactElement } from "react";

import { DrumGrid } from "@/components/editor/DrumGrid";
import { PatternSidebar } from "@/components/editor/PatternSidebar";
import { PianoRoll } from "@/components/editor/PianoRoll";
import { useStudioStore } from "@/stores/studio-provider";

export function PatternEditor(): ReactElement {
  const { project, selectedPatternId, selectedClipId } = useStudioStore((state) => state);
  const pattern = project.patterns.find((item) => item.id === selectedPatternId);
  const clip = project.arrangement.find((item) => item.id === selectedClipId);
  const track = project.tracks.find((item) => item.id === clip?.trackId);
  const uses = project.arrangement.filter((item) => item.patternId === pattern?.id).length;
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
          <div className={`mt-3 min-h-0 flex-1 rounded-[7px] border border-white/10 bg-black/50 ${pattern.kind === "synth" ? "overflow-hidden" : "overflow-auto"}`}>
            {pattern.kind === "drum" ? <DrumGrid pattern={pattern} /> : <PianoRoll key={pattern.id} pattern={pattern} />}
          </div>
        </section>
      ) : <p className="p-6 text-xs text-zinc-500">Select a pattern to view its notes or hits.</p>}
    </div>
  );
}
