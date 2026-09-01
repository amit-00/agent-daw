import type { ReactElement } from "react";

import { ChannelStrip } from "@/components/editor/ChannelStrip";
import { TRACKS } from "@/data/studio-data";

export function Mixer(): ReactElement {
  return (
    <div className="relative z-[1] grid h-[calc(100%-42px)] grid-cols-[repeat(6,210px)] justify-center overflow-x-auto" aria-label="Mixer channels">
      {TRACKS.map((track) => <ChannelStrip key={track.id} track={track} />)}
      <div className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] bg-white/[0.022] px-5 pt-[11px] pb-[9px]">
        <span className="col-span-full overflow-hidden text-center text-[10px] text-ellipsis whitespace-nowrap text-zinc-400">Master</span>
        <span className="col-span-full row-start-2 flex h-[142px] w-3 items-end gap-[3px] self-center justify-self-center">
          <i className="h-[82%] w-1 rounded-full bg-[linear-gradient(0deg,#81e0a0_0_72%,#e2c66c_72%_90%,#ee6678_90%)] opacity-70" />
          <i className="h-[76%] w-1 rounded-full bg-[linear-gradient(0deg,#81e0a0_0_72%,#e2c66c_72%_90%,#ee6678_90%)] opacity-70" />
        </span>
        <label className="col-span-full row-start-3 grid gap-1 text-[9px] text-zinc-500"><span>Volume</span><input className="m-0 h-[3px] w-full [accent-color:#d4d4d8]" aria-label="Master volume" type="range" min="0" max="100" defaultValue="78" /></label>
        <label className="col-span-full row-start-4 grid gap-1 text-[9px] text-zinc-500"><span>Pan</span><input className="m-0 h-[3px] w-full [accent-color:#87878f]" aria-label="Master pan" type="range" min="0" max="100" defaultValue="50" /></label>
        <span className="col-span-full row-start-5 text-center font-mono text-[9px] text-zinc-500">−3.2</span>
      </div>
    </div>
  );
}
