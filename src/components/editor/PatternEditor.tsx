"use client";

import type { CSSProperties, ReactElement } from "react";

import { PatternSidebar } from "@/components/editor/PatternSidebar";
import { getClip, getPattern, getTrack, SEQUENCE_NOTES } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-store";

export function PatternEditor(): ReactElement {
  const selectedPatternId = useStudioStore((state) => state.selectedPatternId);
  const sequenceSteps = useStudioStore((state) => state.sequenceSteps);
  const toggleSequenceStep = useStudioStore((state) => state.toggleSequenceStep);
  const pattern = getPattern(selectedPatternId);
  const clip = getClip(pattern.clipId);
  const track = getTrack(clip.trackId);

  return (
    <div className="grid h-[calc(100%-42px)] grid-cols-[214px_minmax(0,1fr)]">
      <PatternSidebar />
      <section className="h-full min-w-0 px-4 pt-3.5 pb-4" aria-label={`Pattern editor for ${track.name}`} style={{ "--sequence-color": track.color } as CSSProperties}>
        <div className="flex min-h-11 items-start justify-between">
          <span>
            <small className="block text-[9px] font-semibold tracking-[0.12em] text-zinc-600">SELECTED TRACK</small>
            <strong className="mt-1 block text-[11px] font-semibold text-zinc-300">{track.name}</strong>
            <em className="mt-[3px] block text-[10px] not-italic text-zinc-600">{clip.name} · {clip.detail}</em>
          </span>
          <div className="flex gap-[5px]">
            <button className="h-[27px] cursor-pointer rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300" type="button">1 / 16</button>
            <button className="h-[27px] cursor-pointer rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300" type="button">100%</button>
          </div>
        </div>
        <div className="mt-3 grid h-[calc(100%-56px)] grid-cols-[38px_1fr] grid-rows-[20px_1fr] overflow-hidden rounded-[7px] border border-white/10 bg-black/50">
          <div className="col-start-2 grid grid-cols-16 border-b border-white/10 bg-white/[0.025]">
            {Array.from({ length: 16 }, (_, step) => <span className="grid place-items-center border-l border-white/[0.04] font-mono text-[9px] text-zinc-600" key={step}>{step + 1}</span>)}
          </div>
          <div className="row-start-2 grid grid-rows-4 border-r border-white/10 bg-zinc-950">
            {SEQUENCE_NOTES.map((note) => <span className="grid place-items-center border-b border-white/[0.045] font-mono text-[9px] text-zinc-500" key={note}>{note}</span>)}
          </div>
          <div className="col-start-2 row-start-2 grid grid-cols-16 grid-rows-4">
            {Array.from({ length: 64 }, (_, step) => {
              const active = sequenceSteps.has(step);
              const note = SEQUENCE_NOTES[Math.floor(step / 16)];
              return (
                <button className={`relative cursor-pointer border-0 border-r border-b border-white/[0.04] bg-transparent p-0 hover:bg-white/[0.035] ${(step % 16) % 4 === 0 ? "border-l border-l-white/10" : ""}`} key={step} type="button" aria-label={`${active ? "Clear" : "Add"} ${note} at step ${(step % 16) + 1}`} aria-pressed={active} onClick={() => toggleSequenceStep(step)}>
                  {active ? <span className="absolute inset-x-[12%] inset-y-1/4 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--sequence-color) 78%, transparent)" }} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
