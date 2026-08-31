"use client";

import type { ReactElement } from "react";

import { TrackHeader } from "@/components/arrangement/TrackHeader";
import { TrackLane } from "@/components/arrangement/TrackLane";
import { useStudioStore } from "@/stores/studio-provider";

export function Arrangement(): ReactElement {
  const project = useStudioStore((state) => state.project);
  const bars = project.arrangement.reduce((end, clip) => {
    const pattern = project.patterns.find((item) => item.id === clip.patternId);
    return Math.max(end, clip.startBar + (pattern?.lengthBars ?? 0) * clip.repeatCount);
  }, 8);
  return (
    <div className="min-h-0 overflow-auto [scrollbar-color:#29292e_transparent] [scrollbar-width:thin]">
      <section className="relative grid min-h-full grid-cols-[154px_minmax(730px,1fr)] content-start bg-black" aria-label="Song arrangement"
        style={{ minWidth: 154 + bars * 92, gridTemplateRows: `39px repeat(${project.tracks.length},112px)` }}>
        <div className="sticky left-0 z-[3] flex items-center justify-between border-r border-b border-white/10 bg-black px-3 text-[10px] tracking-widest text-zinc-500">
          <span>TRACKS</span>
          <button disabled type="button" aria-label="Add track" className="text-lg text-zinc-600">＋</button>
        </div>
        <div className="col-start-2 grid border-b border-white/10 bg-zinc-950/90 font-mono text-[10px] text-zinc-500" style={{ gridTemplateColumns: `repeat(${bars},1fr)` }}>
          {Array.from({ length: bars }, (_, index) => <span className="border-l border-white/5 px-2 py-3" key={index}>{String(index + 1).padStart(2, "0")}</span>)}
        </div>
        {project.tracks.map((track, index) => <TrackHeader key={track.id} row={index + 2} track={track} />)}
        {project.tracks.map((track, index) => <TrackLane key={track.id + "-lane"} row={index + 2} track={track} bars={bars} />)}
        {project.tracks.length === 0 && <p className="col-span-2 p-6 text-xs text-zinc-500">Add a track to start arranging.</p>}
      </section>
    </div>
  );
}
