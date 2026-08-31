"use client";

import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { SOUND_CATALOG } from "@/audio/catalog";
import { INSTRUMENT_NAMES } from "@/data/studio-data";
import type { Track, TrackKind } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

function TrackDialog({ label, children, onClose }: Readonly<{
  label: string; children: ReactNode; onClose: () => void;
}>): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const errorMessage = useStudioStore((state) => state.errorMessage);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto w-96 rounded-xl border border-white/15 bg-zinc-950 p-6 text-sm text-zinc-200 shadow-xl backdrop:bg-black/70 [&_button]:rounded [&_button]:border [&_button]:border-white/15 [&_button]:px-3 [&_button]:py-2 [&_button]:hover:bg-white/10 [&_button:disabled]:opacity-30 [&_select]:mt-2 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-white/15 [&_select]:bg-zinc-900 [&_select]:p-2">
      <h2 className="mb-5 text-base font-medium">{label}</h2>
      {children}
      {errorMessage && <p role="alert" className="mt-4 text-xs text-rose-300">{errorMessage}</p>}
    </dialog>
  );
}

export function AddTrack({ onClose }: Readonly<{ onClose: () => void }>): ReactElement {
  const createTrack = useStudioStore((state) => state.createTrack);
  const [kind, setKind] = useState<TrackKind>("drum");
  const [instrumentId, setInstrumentId] = useState("kit.basic");
  const instruments = kind === "drum" ? SOUND_CATALOG.drumKits : SOUND_CATALOG.synthPresets;
  return (
    <TrackDialog label="Add track" onClose={onClose}>
      <form className="space-y-5" onSubmit={(event) => {
        event.preventDefault();
        if (createTrack(kind, instrumentId) !== null) onClose();
      }}>
        <fieldset className="flex gap-5">
          <legend className="mb-2 text-xs text-zinc-400">Track type</legend>
          <label className="flex gap-2"><input type="radio" name="track-kind" checked={kind === "drum"} onChange={() => { setKind("drum"); setInstrumentId("kit.basic"); }} />Drums</label>
          <label className="flex gap-2"><input type="radio" name="track-kind" checked={kind === "synth"} onChange={() => { setKind("synth"); setInstrumentId("synth.bass"); }} />Synth</label>
        </fieldset>
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
    </TrackDialog>
  );
}

export function TrackSettings({ track, onClose, onDeleted }: Readonly<{
  track: Track; onClose: () => void; onDeleted: () => void;
}>): ReactElement {
  const { project, renameTrack, setTrackPreset, reorderTrack, deleteTrack } = useStudioStore((state) => state);
  const [name, setName] = useState(track.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const index = project.tracks.findIndex((item) => item.id === track.id);
  const clipCount = project.arrangement.filter((clip) => clip.trackId === track.id).length;
  const instruments = track.kind === "drum" ? SOUND_CATALOG.drumKits : SOUND_CATALOG.synthPresets;
  function remove(): void { deleteTrack(track.id); onDeleted(); }
  return (
    <TrackDialog label={`Track settings for ${track.name}`} onClose={onClose}>
      {confirmDelete ? <div className="space-y-5">
        <p>Delete {track.name} and {clipCount} {clipCount === 1 ? "clip" : "clips"}? Patterns remain in the library. You can undo this.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)}>Keep track</button>
          <button type="button" className="text-rose-300" onClick={remove}>Confirm delete</button>
        </div>
      </div> : <div className="space-y-5">
        <p className="text-xs text-zinc-500">{track.kind === "drum" ? "Drum" : "Synth"} track · Type cannot be changed</p>
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
        <div className="flex justify-between border-t border-white/10 pt-4">
          <button type="button" className="text-rose-300" onClick={() => clipCount > 0 ? setConfirmDelete(true) : remove()}>Delete track</button>
          <button type="button" aria-label="Close track settings" onClick={onClose}>Done</button>
        </div>
      </div>}
    </TrackDialog>
  );
}
