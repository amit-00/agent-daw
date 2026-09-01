"use client";

import type { ReactElement } from "react";

import { Icon, TransportIcon } from "@/components/icons";
import { useStudioStore } from "@/stores/studio-store";

function formatTime(playhead: number): string {
  const seconds = Math.round(playhead * 0.78);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.0`;
}

export function Transport(): ReactElement {
  const isPlaying = useStudioStore((state) => state.isPlaying);
  const togglePlayback = useStudioStore((state) => state.togglePlayback);
  const stopPlayback = useStudioStore((state) => state.stopPlayback);
  const activityOpen = useStudioStore((state) => state.activityOpen);
  const toggleActivity = useStudioStore((state) => state.toggleActivity);

  return (
    <header className="relative z-[4] grid min-h-[58px] grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/10 bg-zinc-950/95 px-3.5 backdrop-blur-[18px]" role="banner">
      <div className="flex min-w-0 items-center gap-1">
        <button className="flex items-center gap-2 rounded-[7px] border-0 bg-transparent px-2 py-[7px] text-xs text-zinc-300 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button">
          <span className="text-[15px] text-zinc-400">◫</span>
          <span>Midnight Polaroid</span>
          <span className="rounded bg-white/5 px-[5px] py-0.5 text-[10px] text-zinc-500">v1</span>
          <Icon name="chevron" />
        </button>
      </div>

      <div className="flex items-center gap-2.5 justify-self-center">
        <div className="flex items-center gap-3.5 text-xs text-zinc-300" aria-label="Project tempo">
          <span className="flex items-baseline gap-1.5"><small className="text-[10px] font-semibold text-zinc-600">BPM</small><strong className="text-xs font-medium">118</strong></span>
          <span className="min-w-[49px] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-center font-mono text-[11px] text-zinc-400">{formatTime(27)}</span>
        </div>

        <div className="flex items-center gap-px rounded-[9px] border border-white/10 bg-zinc-900 p-[3px]" aria-label="Playback controls">
          <button className="grid h-[29px] w-8 place-items-center rounded-[7px] border-0 bg-white text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label={isPlaying ? "Pause" : "Play"} aria-pressed={isPlaying} onClick={togglePlayback}>
            <TransportIcon name={isPlaying ? "pause" : "play"} />
          </button>
          <button className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Stop" onClick={stopPlayback}><TransportIcon name="stop" /></button>
          <button className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-rose-400 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Record"><TransportIcon name="record" /></button>
          <button className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Loop playback"><TransportIcon name="loop" /></button>
        </div>

        <div className="flex items-center gap-px" aria-label="Edit history">
          <button className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Undo"><TransportIcon name="undo" /></button>
          <button className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label="Redo"><TransportIcon name="redo" /></button>
        </div>

        <div className="flex items-center justify-end gap-[7px] text-zinc-500" aria-label="Master output level">
          <TransportIcon name="speaker" />
          <span className="relative h-[3px] w-[62px] overflow-hidden rounded-full bg-zinc-800"><span className="block h-full w-[68%] bg-zinc-300" /></span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button className="flex items-center gap-[7px] rounded-[7px] border border-white/15 bg-white/[0.055] px-3 py-2 text-xs text-zinc-200 hover:border-white/20 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button">
          <Icon name="download" /> Export
        </button>
        <button className={`flex items-center gap-[7px] rounded-[7px] border border-white/15 px-3 py-2 text-xs hover:border-white/20 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 ${activityOpen ? "bg-white/[0.08] text-zinc-200" : "bg-transparent text-zinc-500"}`} type="button" aria-label={activityOpen ? "Hide activity" : "Show activity"} aria-pressed={activityOpen} onClick={toggleActivity}>
          <Icon name="activity" /> Activity
        </button>
      </div>
    </header>
  );
}
