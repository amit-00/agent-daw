"use client";

import type { ReactElement } from "react";

import { DrumGrid } from "@/components/editor/DrumGrid";
import { PatternSidebar } from "@/components/editor/PatternSidebar";
import { PianoRoll } from "@/components/editor/PianoRoll";
import { useStudioStore } from "@/stores/studio-provider";

export function PatternEditor(): ReactElement {
  const { project, selectedPatternId } = useStudioStore((state) => state);
  const pattern = project.patterns.find((item) => item.id === selectedPatternId);
  const uses = project.arrangement.filter((item) => item.patternId === pattern?.id).length;
  return (
    <div className="grid h-full grid-cols-[214px_minmax(0,1fr)]">
      <PatternSidebar />
      {pattern ? (
        <section className="flex min-h-0 min-w-0 flex-col px-4 pt-3.5 pb-4" aria-label={`Pattern editor for ${pattern.name}`}>
          <div className="flex h-8 items-center justify-between gap-3">
            <div className="min-w-0 truncate whitespace-nowrap text-xs text-zinc-600">
              <small className="font-semibold tracking-[0.12em]">SELECTED PATTERN</small>
              <span> · </span><strong className="font-semibold text-zinc-300">{pattern.name}</strong>
              <span> · {pattern.lengthBars} bar{pattern.lengthBars === 1 ? "" : "s"} · {pattern.events.length} {pattern.kind === "drum" ? "hits" : "notes"} · {uses === 0 ? "Unplaced" : `${uses} placements`}</span>
            </div>
            <div className="flex gap-[5px]" aria-label="Fixed grid settings">
              <span className="grid h-[27px] place-items-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-zinc-500">1 / 16</span>
              <span className="grid h-[27px] place-items-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-zinc-500">100%</span>
            </div>
          </div>
          <div className={`mt-2 min-h-0 flex-1 rounded-[7px] border border-white/10 bg-black/50 ${pattern.kind === "synth" ? "overflow-hidden" : "overflow-auto"}`}>
            {pattern.kind === "drum" ? <DrumGrid pattern={pattern} /> : <PianoRoll key={pattern.id} pattern={pattern} />}
          </div>
        </section>
      ) : <p className="p-6 text-xs text-zinc-500">Select a pattern to view its notes or hits.</p>}
    </div>
  );
}
