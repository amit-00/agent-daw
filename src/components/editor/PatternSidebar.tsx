"use client";

import type { ReactElement } from "react";

import { useStudioStore } from "@/stores/studio-provider";

export function PatternSidebar(): ReactElement {
  const { project, selectedPatternId, selectPattern } = useStudioStore((state) => state);
  return (
    <aside className="min-w-0 overflow-y-auto border-r border-white/10 bg-black/20 px-2.5 py-4" aria-label="Project patterns">
      <span className="block text-[9px] font-semibold tracking-[0.15em] text-zinc-600">PROJECT PATTERNS</span>
      <div className="mt-3 grid gap-1">
        {project.patterns.map((pattern) => {
          const uses = project.arrangement.filter((clip) => clip.patternId === pattern.id).length;
          const active = selectedPatternId === pattern.id;
          return (
            <button type="button" key={pattern.id} aria-label={`Select pattern ${pattern.name}`} aria-pressed={active} onClick={() => selectPattern(pattern.id)}
              className={`min-w-0 cursor-pointer rounded-md border px-[9px] py-2 text-left ${active ? "border-violet-400/40 bg-violet-400/15 text-violet-100" : "border-transparent bg-transparent text-zinc-500 hover:bg-white/[0.045] hover:text-zinc-300"}`}>
              <strong className="block overflow-hidden text-[10px] font-semibold text-ellipsis whitespace-nowrap">{pattern.name}</strong>
              <small className={`mt-[3px] block overflow-hidden text-[9px] text-ellipsis whitespace-nowrap ${active ? "text-violet-300/75" : "text-zinc-600"}`}>{pattern.lengthBars} bars · {uses === 0 ? "Unplaced" : `${uses} placements`}</small>
            </button>
          );
        })}
        {project.patterns.length === 0 && <p className="text-xs text-zinc-500">No patterns yet</p>}
      </div>
    </aside>
  );
}
