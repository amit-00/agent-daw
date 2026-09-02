"use client";

import { useState, type ReactElement } from "react";

import { downloadProjectWav, WavExportError } from "@/audio";
import { Icon, TransportIcon } from "@/components/icons";
import { useStudioStore } from "@/stores/studio-provider";

const formatPosition = (step: number, bpm: number): string => {
  const tenths = Math.round(step * 600 / bpm / 4);
  const minutes = Math.floor(tenths / 600);
  return `${minutes}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

export function Transport(): ReactElement {
  const { project, audio, persistence, playPause, stopPlayback, history, historyCursor, undo, redo, activityOpen, toggleActivity, webMCPStatus } = useStudioStore((state) => state);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    if (exporting || project.arrangement.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadProjectWav(structuredClone(project), {});
    } catch (error) {
      setExportError(error instanceof WavExportError
        ? error.message
        : "WAV export failed; retry the export");
    } finally {
      setExporting(false);
    }
  }

  const isClosed = audio.snapshot.status === "closed";
  const playDisabled = !audio.engineReady || audio.pending || isClosed;
  const stopDisabled = !audio.engineReady || isClosed
    || (!audio.pending && audio.snapshot.status === "stopped" && audio.snapshot.positionStep === 0);
  const playbackLabel = audio.snapshot.status === "playing" ? "Pause" : "Play";
  const audioSubtitle = audio.pending ? "Preparing audio" : isClosed || audio.errorMessage ? "Audio unavailable"
    : audio.snapshot.status === "blocked" ? "Audio blocked"
      : audio.snapshot.unavailableSoundIds.length > 0 ? "Degraded audio"
        : audio.snapshot.lastIssue?.message ?? "Audio ready";
  const persistenceSubtitle = persistence.status === "saving" ? "Saving" : persistence.status === "saved" ? "Saved locally; Activity/history is session-only"
    : persistence.status === "memory-only" ? "In memory" : persistence.status === "failed" ? "Storage unavailable" : "Not saved yet";
  const webMCPStatusLabel = webMCPStatus[0]!.toUpperCase() + webMCPStatus.slice(1);
  return (
    <header className="relative z-[4] grid min-h-[58px] grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/10 bg-zinc-950/95 px-3.5 backdrop-blur-[18px]" role="banner">
      <div className="flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-[7px] text-xs text-zinc-300">
        <span className="text-[15px] text-zinc-400" aria-hidden="true">◫</span>
        <div className="min-w-0">
          <span className="block truncate">{project.name}</span>
          <small className="mt-0.5 block text-[9px] text-zinc-500">{audioSubtitle} · {persistenceSubtitle}</small>
          <span role="status" aria-label={`WebMCP status: ${webMCPStatusLabel}`} className="mt-0.5 block text-[9px] text-zinc-500">WebMCP: {webMCPStatusLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 justify-self-center">
        <div className="flex items-center gap-3.5 text-xs text-zinc-300" aria-label="Project tempo">
          <span className="flex items-baseline gap-1.5"><small className="text-[10px] font-semibold text-zinc-600">BPM</small><strong className="text-xs font-medium">{project.bpm}</strong></span>
          <span className="min-w-[49px] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-center font-mono text-[11px] text-zinc-400" aria-label="Playback position">{formatPosition(audio.snapshot.positionStep, project.bpm)}</span>
        </div>
        <div className="flex items-center gap-px rounded-[9px] border border-white/10 bg-zinc-900 p-[3px]" aria-label="Playback controls">
          <button type="button" aria-label={playbackLabel} disabled={playDisabled} onClick={() => { void playPause(); }} className="grid h-[29px] w-8 place-items-center rounded-[7px] border-0 bg-white text-zinc-950"><TransportIcon name={audio.snapshot.status === "playing" ? "pause" : "play"} /></button>
          <button type="button" aria-label="Stop" disabled={stopDisabled} onClick={stopPlayback} className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500"><TransportIcon name="stop" /></button>
          <button disabled type="button" aria-label="Record" className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-rose-400"><TransportIcon name="record" /></button>
          <button disabled type="button" aria-label="Loop playback" className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500"><TransportIcon name="loop" /></button>
        </div>
        <div className="flex items-center gap-px" aria-label="Edit history">
          <button type="button" aria-label="Undo" disabled={historyCursor < 0} onClick={undo} className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 enabled:hover:bg-white/[0.06] enabled:hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:text-zinc-700"><TransportIcon name="undo" /></button>
          <button type="button" aria-label="Redo" disabled={historyCursor >= history.length - 1} onClick={redo} className="grid h-[29px] w-[29px] place-items-center rounded-[7px] border-0 bg-transparent text-zinc-500 enabled:hover:bg-white/[0.06] enabled:hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:text-zinc-700"><TransportIcon name="redo" /></button>
        </div>
        <div className="flex items-center justify-end gap-[7px] text-zinc-500" aria-label={audioSubtitle} title={audioSubtitle}>
          <TransportIcon name="speaker" />
          <span className="h-[3px] w-[62px] rounded-full bg-zinc-800" aria-hidden="true" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={exporting || project.arrangement.length === 0}
          aria-busy={exporting}
          title={project.arrangement.length === 0
            ? "Add an arrangement clip before exporting WAV"
            : "Download WAV"}
          onClick={() => void handleExport()}
          className="flex items-center gap-[7px] rounded-[7px] border border-white/15 bg-white/[0.055] px-3 py-2 text-xs text-zinc-200 enabled:hover:border-white/25 enabled:hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:text-zinc-600"
        >
          <Icon name="download" /> {exporting ? "Exporting…" : "Export"}
        </button>
        {exporting && <span className="sr-only" role="status">Exporting WAV</span>}
        {exportError && <p className="absolute right-3 top-full mt-2 rounded-md border border-rose-400/20 bg-rose-950/95 px-3 py-2 text-xs text-rose-200" role="alert">{exportError}</p>}
        <button type="button" aria-label={activityOpen ? "Hide activity" : "Show activity"} aria-pressed={activityOpen} onClick={toggleActivity} className={`flex items-center gap-[7px] rounded-[7px] border border-white/15 px-3 py-2 text-xs hover:border-white/20 hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 ${activityOpen ? "bg-white/[0.08] text-zinc-200" : "bg-transparent text-zinc-500"}`}><Icon name="activity" /> Activity</button>
      </div>
    </header>
  );
}
