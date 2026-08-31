"use client";

import type { ReactElement } from "react";

import { Icon, TransportIcon } from "@/components/icons";
import { useStudioStore } from "@/stores/studio-provider";

export function Transport(): ReactElement {
  const { project, history, historyCursor, undo, redo, activityOpen, toggleActivity } = useStudioStore((state) => state);
  return (
    <header className="relative z-[4] grid min-h-[68px] grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/10 bg-zinc-950/95 px-3.5" role="banner">
      <div className="min-w-0 px-2">
        <span className="block truncate text-xs text-zinc-300">{project.name}</span>
        <span className="mt-1 block text-[10px] text-amber-200/70">Silent · In memory · Edits lost on refresh</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="mr-2 text-xs text-zinc-300" aria-label="Project tempo"><small className="mr-1.5 text-zinc-500">BPM</small>{project.bpm}</span>
        <div className="flex gap-1 rounded-lg border border-white/10 bg-zinc-900 p-1" aria-label="Playback controls">
          <button disabled type="button" aria-label="Play" title="Playback is not connected in this silent editor" className="grid h-7 w-8 place-items-center rounded bg-white/10 text-zinc-500"><TransportIcon name="play" /></button>
          <button disabled type="button" aria-label="Stop" className="grid h-7 w-7 place-items-center text-zinc-600"><TransportIcon name="stop" /></button>
          <button disabled type="button" aria-label="Record" className="grid h-7 w-7 place-items-center text-zinc-600"><TransportIcon name="record" /></button>
          <button disabled type="button" aria-label="Loop playback" className="grid h-7 w-7 place-items-center text-zinc-600"><TransportIcon name="loop" /></button>
        </div>
        <div className="flex gap-1" aria-label="Edit history">
          <button type="button" aria-label="Undo" disabled={historyCursor < 0} onClick={undo} className="grid h-8 w-8 place-items-center rounded text-zinc-200 hover:bg-white/10 disabled:text-zinc-700"><TransportIcon name="undo" /></button>
          <button type="button" aria-label="Redo" disabled={historyCursor >= history.length - 1} onClick={redo} className="grid h-8 w-8 place-items-center rounded text-zinc-200 hover:bg-white/10 disabled:text-zinc-700"><TransportIcon name="redo" /></button>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button disabled type="button" title="Export is not available in this silent editor" className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs text-zinc-600"><Icon name="download" /> Export</button>
        <button type="button" aria-label={activityOpen ? "Hide activity" : "Show activity"} aria-pressed={activityOpen} onClick={toggleActivity} className="flex items-center gap-2 rounded border border-white/15 bg-white/5 px-3 py-2 text-xs text-zinc-300"><Icon name="activity" /> Activity</button>
      </div>
    </header>
  );
}
