import type { ReactElement } from "react";

import { Playhead } from "@/components/arrangement/Playhead";
import { TrackHeader } from "@/components/arrangement/TrackHeader";
import { TrackLane } from "@/components/arrangement/TrackLane";
import { TRACKS } from "@/data/studio-data";

export function Arrangement(): ReactElement {
  return (
    <div className="min-h-0 overflow-auto [scrollbar-color:#29292e_transparent] [scrollbar-width:thin]">
      <section className="relative grid h-full min-h-[650px] min-w-[870px] grid-cols-[154px_minmax(730px,1fr)] grid-rows-[39px_repeat(5,112px)] content-start bg-black bg-[linear-gradient(90deg,rgba(255,255,255,0.12)_2px,transparent_2px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-position:154px_0,154px_0] [background-size:calc((100%_-_154px)/2)_100%,calc((100%_-_154px)/16)_100%]" aria-label="Song arrangement">
        <div className="sticky left-0 z-[3] flex items-center justify-between border-r border-b border-white/10 bg-black px-[11px] text-[10px] tracking-[0.12em] text-zinc-600">
          <span>TRACKS</span>
          <button className="border-0 bg-transparent text-[15px] text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Add track">＋</button>
        </div>
        <div className="col-start-2 grid grid-cols-8 border-b border-white/10 bg-zinc-950/90 font-mono text-[10px] text-zinc-600">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => <span className="border-l border-white/[0.045] px-[7px] py-[13px]" key={bar}>{String(bar).padStart(2, "0")}</span>)}
        </div>
        {TRACKS.map((track, index) => <TrackHeader key={track.id} row={index + 2} track={track} />)}
        {TRACKS.map((track, index) => <TrackLane key={`${track.id}-lane`} row={index + 2} track={track} />)}
        <Playhead />
      </section>
    </div>
  );
}
