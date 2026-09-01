"use client";

import type { ReactElement } from "react";

import { ChannelStrip, MixerControl } from "@/components/editor/ChannelStrip";
import { useStudioStore } from "@/stores/studio-provider";

export function Mixer(): ReactElement {
  const { project, setMasterVolume } = useStudioStore((state) => state);
  return (
    <section className="relative z-[1] grid h-[calc(100%-42px)] overflow-x-auto" aria-label="Mixer channels"
      style={{ gridTemplateColumns: `repeat(${project.tracks.length + 1},210px)`, justifyContent: "safe center" }}>
      {project.tracks.map((track) => <ChannelStrip key={track.id} track={track} />)}
      <div role="group" aria-label="Master channel" className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] bg-white/[0.022] px-5 pt-[11px] pb-[9px]">
        <span className="col-span-full overflow-hidden text-center text-[10px] text-ellipsis whitespace-nowrap text-zinc-400">Master</span>
        <span className="col-span-full row-start-2 flex h-[142px] w-3 items-end gap-[3px] self-center justify-self-center" aria-hidden="true" title="Audio disconnected">
          <i className="h-full w-1 rounded-full bg-zinc-800/50" /><i className="h-full w-1 rounded-full bg-zinc-800/50" />
        </span>
        <div className="col-span-full row-start-3"><MixerControl label="Master volume" value={project.masterVolumeDb} min={-60} max={0} step={0.1} unit="dB" onCommit={setMasterVolume} /></div>
        <span className="col-span-full row-start-5 text-center font-mono text-[9px] text-zinc-500">{project.masterVolumeDb} dB</span>
      </div>
    </section>
  );
}
