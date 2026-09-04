"use client";

import { useState, type ReactElement } from "react";

import { SOUND_CATALOG } from "@/audio/catalog";
import { EditorDialog } from "@/components/editor/EditorDialog";
import { INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function AddTrack({ onClose }: Readonly<{ onClose: () => void }>): ReactElement {
  const createTrack = useStudioStore((state) => state.createTrack);
  const [instrumentId, setInstrumentId] = useState("kit.basic");
  const instruments = [...SOUND_CATALOG.drumKits, ...SOUND_CATALOG.synthPresets];
  return (
    <EditorDialog label="Add track" onClose={onClose}>
      <form className="space-y-5" onSubmit={(event) => {
        event.preventDefault();
        const kind = SOUND_CATALOG.drumKits.some(({ id }) => id === instrumentId) ? "drum" : "synth";
        if (createTrack(kind, instrumentId) !== null) onClose();
      }}>
        <label className="block text-xs text-zinc-400">Instrument
          <select value={instrumentId} onChange={(event) => setInstrumentId(event.target.value)}>
            {instruments.map(({ id }) => <option key={id} value={id}>{INSTRUMENT_NAMES[id] ?? id}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="bg-violet-500/20 text-violet-200">Create track</button>
        </div>
      </form>
    </EditorDialog>
  );
}

export function TrackSettings({ track, onClose, onDeleted }: Readonly<{
  track: Track; onClose: () => void; onDeleted: () => void;
}>): ReactElement {
  const { project, renameTrack, setTrackPreset, reorderTrack, deleteTrack, createPatternAt } = useStudioStore((state) => state);
  const [name, setName] = useState(track.name);
  const [startBar, setStartBar] = useState("1");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const index = project.tracks.findIndex((item) => item.id === track.id);
  const clipCount = project.arrangement.filter((clip) => clip.trackId === track.id).length;
  const instruments = track.kind === "drum" ? SOUND_CATALOG.drumKits : SOUND_CATALOG.synthPresets;
  function remove(): void { deleteTrack(track.id); onDeleted(); }
  return (
    <EditorDialog label={`Track settings for ${track.name}`} onClose={onClose}>
      {confirmDelete ? <div className="space-y-5">
        <p>Delete {track.name} and {clipCount} {clipCount === 1 ? "clip" : "clips"}? Patterns used elsewhere remain. You can undo this.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)}>Keep track</button>
          <button type="button" className="text-rose-300" onClick={remove}>Confirm delete</button>
        </div>
      </div> : <div className="space-y-5">
        <p className="text-xs text-zinc-500">Only compatible instruments are shown.</p>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); renameTrack(track.id, name); }}>
          <label className="block text-xs text-zinc-400">Track name
            <input required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded border border-white/15 bg-zinc-900 p-2 text-sm text-zinc-200" />
          </label>
          <button type="submit">Rename track</button>
        </form>
        <label className="block text-xs text-zinc-400">Instrument
          <select value={track.instrumentId} onChange={(event) => setTrackPreset(track.id, event.target.value)}>
            {instruments.map(({ id }) => <option key={id} value={id}>{INSTRUMENT_NAMES[id] ?? id}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={index === 0} onClick={() => reorderTrack(track.id, index - 1)}>Move up</button>
          <button type="button" disabled={index === project.tracks.length - 1} onClick={() => reorderTrack(track.id, index + 1)}>Move down</button>
        </div>
        <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (createPatternAt(track.id, Number(startBar) - 1) !== null) onClose();
        }}>
          <label className="block text-xs text-zinc-400">New pattern starting bar
            <input type="number" min={1} max={256} step={1} required value={startBar} onChange={(event) => setStartBar(event.target.value)} />
          </label>
          <button type="submit">Create pattern here</button>
        </form>
        <div className="flex justify-between border-t border-white/10 pt-4">
          <button type="button" className="text-rose-300" onClick={() => clipCount > 0 ? setConfirmDelete(true) : remove()}>Delete track</button>
          <button type="button" aria-label="Close track settings" onClick={onClose}>Done</button>
        </div>
      </div>}
    </EditorDialog>
  );
}
