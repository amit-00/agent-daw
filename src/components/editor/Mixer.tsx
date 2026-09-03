"use client";

import type { ReactElement } from "react";

import { ChannelStrip, LevelMeter, MixerControl } from "@/components/editor/ChannelStrip";
import { useStudioStore } from "@/stores/studio-provider";

export function Mixer(): ReactElement {
  const { project, setMasterVolume } = useStudioStore((state) => state);
  const masterLevel = useStudioStore((state) => state.audio.snapshot.masterLevel);
  return (
    <section className="relative z-[1] grid h-[calc(100%-42px)] overflow-x-auto" aria-label="Mixer channels"
      style={{ gridTemplateColumns: `repeat(${project.tracks.length + 1},210px)`, justifyContent: "safe center" }}>
      {project.tracks.map((track) => <ChannelStrip key={track.id} track={track} />)}
      <div role="group" aria-label="Master channel" className="grid w-[210px] grid-rows-[25px_1fr_30px_30px_20px] bg-white/[0.022] px-5 pt-[11px] pb-[9px]">
        <span className="col-span-full overflow-hidden text-center text-xs text-ellipsis whitespace-nowrap text-zinc-400">Master</span>
        <LevelMeter label="Master level" level={masterLevel} />
        <div className="col-span-full row-start-3"><MixerControl label="Volume" accessibleLabel="Master volume" value={project.masterVolumeDb} min={-60} max={0} step={0.1} unit="dB" onCommit={setMasterVolume} /></div>
        <span className="col-span-full row-start-5 text-center font-mono text-[11px] text-zinc-500">{project.masterVolumeDb} dB</span>
      </div>
    </section>
  );
}
