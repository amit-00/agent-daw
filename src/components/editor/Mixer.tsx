"use client";

import type { ReactElement } from "react";

import { ChannelStrip } from "@/components/editor/ChannelStrip";
import { useStudioStore } from "@/stores/studio-provider";

export function Mixer(): ReactElement {
  const project = useStudioStore((state) => state.project);
  return (
    <section className="flex h-[calc(100%-42px)] overflow-x-auto" aria-label="Mixer channels">
      {project.tracks.map((track) => <ChannelStrip key={track.id} track={track} />)}
      <div role="group" aria-label="Master channel" className="flex w-[210px] shrink-0 flex-col gap-4 bg-white/[0.022] px-5 py-4">
        <span className="text-center text-xs text-zinc-300">Master</span>
        <small className="text-center text-[10px] text-zinc-500">Mixer editing coming next</small>
        <label className="mt-auto grid gap-2 text-[10px] text-zinc-400"><span>Volume · {project.masterVolumeDb} dB</span><input disabled aria-label="Master volume" type="range" min="-60" max="0" value={project.masterVolumeDb} /></label>
      </div>
    </section>
  );
}
