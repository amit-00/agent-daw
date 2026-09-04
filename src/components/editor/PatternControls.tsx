"use client";

import { useState, type ReactElement } from "react";

import { SOUND_CATALOG } from "@/audio/catalog";
import { EditorDialog } from "@/components/editor/EditorDialog";
import { ProjectValidationError, validateOperation, type ArrangementClip, type Pattern, type PatternLengthBars, type Project, type Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

function isCompatible(project: Project, pattern: Pattern, track: Track): boolean {
  try {
    validateOperation({ ...project, arrangement: [] }, { type: "arrangement.place", clip: {
      id: "compatibility-preview", patternId: pattern.id, trackId: track.id, startBar: 0, repeatCount: 1,
    } }, SOUND_CATALOG);
    return true;
  } catch (error) {
    if (error instanceof ProjectValidationError) return false;
    throw error;
  }
}

function DestinationTrack({ label, pattern, trackId, onChange }: Readonly<{
  label: string; pattern: Pattern; trackId: string; onChange: (trackId: string) => void;
}>): ReactElement {
  const project = useStudioStore((state) => state.project);
  const compatible = project.tracks.filter((track) => isCompatible(project, pattern, track));
  return <label className="block text-xs text-zinc-400">{label}
    <select required value={trackId} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose a compatible track</option>
      {compatible.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
    </select>
    {compatible.length === 0 && <span className="mt-2 block">Add a compatible instrument track before placing this pattern.</span>}
  </label>;
}

export function ClipSettings({ clip, pattern, onClose }: Readonly<{
  clip: ArrangementClip; pattern: Pattern; onClose: () => void;
}>): ReactElement {
  const { project, updateClip, duplicateClip, deleteClip, makeClipUnique, renamePattern, setPatternLength, duplicatePatternAt, deletePattern } = useStudioStore((state) => state);
  const [name, setName] = useState(pattern.name);
  const [trackId, setTrackId] = useState(clip.trackId);
  const [startBar, setStartBar] = useState(String(clip.startBar + 1));
  const [repeatCount, setRepeatCount] = useState(String(clip.repeatCount));
  const [duplicateTrackId, setDuplicateTrackId] = useState(clip.trackId);
  const [duplicateStartBar, setDuplicateStartBar] = useState(String(clip.startBar + 1));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uses = project.arrangement.filter((item) => item.patternId === pattern.id).length;
  return <EditorDialog label={`Clip settings for ${pattern.name}`} onClose={onClose}>
    {confirmDelete ? <div className="space-y-5">
      <p>Delete {pattern.name} and its {uses} {uses === 1 ? "placement" : "placements"} across all tracks? You can undo this.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setConfirmDelete(false)}>Keep pattern</button>
        <button type="button" className="text-rose-300" onClick={() => { deletePattern(pattern.id); onClose(); }}>Confirm delete</button>
      </div>
    </div> : <div className="space-y-5">
      <p className="text-xs text-zinc-500">{pattern.name} · {uses} {uses === 1 ? "placement" : "placements"}. Duplicate clip shares the pattern; Make unique copies its content.</p>
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); renamePattern(pattern.id, name); }}>
        <label className="block text-xs text-zinc-400">Pattern name
          <input required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Rename pattern</button>
      </form>
      <label className="block text-xs text-zinc-400">Pattern length
        <select value={pattern.lengthBars} onChange={(event) => setPatternLength(pattern.id, Number(event.target.value) as PatternLengthBars)}>
          <option value={1}>1 bar</option><option value={2}>2 bars</option><option value={4}>4 bars</option>
        </select>
      </label>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        updateClip(clip.id, { trackId, startBar: Number(startBar) - 1, repeatCount: Number(repeatCount) });
      }}>
        <DestinationTrack label="Destination track" pattern={pattern} trackId={trackId} onChange={setTrackId} />
        <label className="block text-xs text-zinc-400">Starting bar
          <input type="number" required min={1} max={256} step={1} value={startBar} onChange={(event) => setStartBar(event.target.value)} />
        </label>
        <label className="block text-xs text-zinc-400">Repeat count
          <input type="number" required min={1} max={64} step={1} value={repeatCount} onChange={(event) => setRepeatCount(event.target.value)} />
        </label>
        <button type="submit">Apply placement</button>
      </form>
      <div className="flex gap-2">
        <button type="button" onClick={() => { if (duplicateClip(clip.id) !== null) onClose(); }}>Duplicate clip</button>
        <button type="button" disabled={uses === 1} onClick={() => makeClipUnique(clip.id)}>{uses === 1 ? "Already unique" : "Make unique"}</button>
      </div>
      <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={(event) => {
        event.preventDefault();
        if (duplicatePatternAt(pattern.id, duplicateTrackId, Number(duplicateStartBar) - 1) !== null) onClose();
      }}>
        <DestinationTrack label="Duplicate destination track" pattern={pattern} trackId={duplicateTrackId} onChange={setDuplicateTrackId} />
        <label className="block text-xs text-zinc-400">Duplicate starting bar
          <input type="number" required min={1} max={256} step={1} value={duplicateStartBar} onChange={(event) => setDuplicateStartBar(event.target.value)} />
        </label>
        <button type="submit" disabled={!duplicateTrackId}>Duplicate pattern</button>
      </form>
      <div className="flex justify-between border-t border-white/10 pt-4">
        <button type="button" className="text-rose-300" onClick={() => setConfirmDelete(true)}>Delete pattern</button>
        <button type="button" className="text-rose-300" onClick={() => { deleteClip(clip.id); onClose(); }}>Delete clip</button>
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </div>}
  </EditorDialog>;
}
