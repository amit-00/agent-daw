"use client";

import type { ReactElement } from "react";

import { getClip, getTrack, PROJECT_PATTERNS } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-store";

export function PatternSidebar(): ReactElement {
  const selectedPatternId = useStudioStore((state) => state.selectedPatternId);
  const selectPattern = useStudioStore((state) => state.selectPattern);

  return (
    <aside className="min-w-0 overflow-y-auto border-r border-white/10 bg-black/20 px-2.5 py-4" aria-label="Project patterns">
      <span className="block text-[9px] font-semibold tracking-[0.15em] text-zinc-600">PROJECT PATTERNS</span>
      <div className="mt-3 grid gap-1">
        {PROJECT_PATTERNS.map((pattern) => {
          const clip = getClip(pattern.clipId);
          const track = getTrack(clip.trackId);
          const active = selectedPatternId === pattern.id;
          return (
            <button className={`min-w-0 cursor-pointer rounded-md border px-[9px] py-2 text-left ${active ? "border-violet-400/40 bg-violet-400/15 text-violet-100" : "border-transparent bg-transparent text-zinc-500 hover:bg-white/[0.045] hover:text-zinc-300"}`} key={pattern.id} type="button" aria-label={`Select pattern ${clip.name}`} aria-pressed={active} onClick={() => selectPattern(pattern.id)}>
              <strong className="block overflow-hidden text-[10px] font-semibold text-ellipsis whitespace-nowrap">{clip.name}</strong>
              <small className={`mt-[3px] block overflow-hidden text-[9px] text-ellipsis whitespace-nowrap ${active ? "text-violet-300/75" : "text-zinc-600"}`}>{track.name} · {clip.detail}</small>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
