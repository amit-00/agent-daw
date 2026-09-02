"use client";

import { useState, type ReactElement } from "react";

import { SOUND_CATALOG } from "@/audio/catalog";
import { EditorDialog } from "@/components/editor/EditorDialog";
import { ProjectValidationError, validateOperation, type ArrangementClip, type Pattern, type PatternLengthBars, type Project, type Track, type TrackKind } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function AddPattern({ onClose }: Readonly<{ onClose: () => void }>): ReactElement {
  const createPattern = useStudioStore((state) => state.createPattern);
  const [kind, setKind] = useState<TrackKind>("drum");
  return <EditorDialog label="Add pattern" onClose={onClose}>
    <form className="space-y-5" onSubmit={(event) => {
      event.preventDefault();
      if (createPattern(kind) !== null) onClose();
    }}>
      <label className="block text-xs text-zinc-400">Pattern editor
        <select value={kind} onChange={(event) => setKind(event.target.value as TrackKind)}>
          <option value="drum">Drum grid</option><option value="synth">Piano roll</option>
        </select>
      </label>
      <p className="text-xs text-zinc-500">Creates an empty one-bar pattern in the library. Place it on a track when ready.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="bg-violet-500/20 text-violet-200">Create pattern</button>
      </div>
    </form>
  </EditorDialog>;
}

function isCompatible(project: Project, pattern: Pattern, track: Track): boolean {
  if (track.kind !== pattern.kind) return false;
  try {
    validateOperation({
      ...project,
      arrangement: [{ id: "compatibility-preview", patternId: pattern.id, trackId: track.id, startBar: 0, repeatCount: 1 }],
    }, { type: "track.update", trackId: track.id, changes: { instrumentId: track.instrumentId } }, SOUND_CATALOG);
    return true;
  } catch (error) {
    if (error instanceof ProjectValidationError) return false;
    throw error;
  }
}

function DestinationTrack({ pattern, trackId, onChange }: Readonly<{
  pattern: Pattern; trackId: string; onChange: (trackId: string) => void;
}>): ReactElement {
  const project = useStudioStore((state) => state.project);
  const compatible = project.tracks.filter((track) => isCompatible(project, pattern, track));
  return <label className="block text-xs text-zinc-400">Destination track
    <select required value={trackId} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose a compatible track</option>
      {compatible.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
    </select>
    {compatible.length === 0 && <span className="mt-2 block">Add a compatible instrument track before placing this pattern.</span>}
  </label>;
}

export function PatternSettings({ pattern, onClose, onDeleted }: Readonly<{
  pattern: Pattern; onClose: () => void; onDeleted: () => void;
}>): ReactElement {
  const { project, renamePattern, setPatternLength, duplicatePattern, deletePattern, placePattern } = useStudioStore((state) => state);
  const [name, setName] = useState(pattern.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trackId, setTrackId] = useState("");
  const [startBar, setStartBar] = useState("1");
  const uses = project.arrangement.filter((clip) => clip.patternId === pattern.id).length;
  function remove(): void { deletePattern(pattern.id); onDeleted(); }
  return <EditorDialog label={`Pattern settings for ${pattern.name}`} onClose={onClose}>
    {confirmDelete ? <div className="space-y-5">
      <p>Delete {pattern.name} and its {uses} {uses === 1 ? "placement" : "placements"} across all tracks? You can undo this.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setConfirmDelete(false)}>Keep pattern</button>
        <button type="button" className="text-rose-300" onClick={remove}>Confirm delete</button>
      </div>
    </div> : <div className="space-y-5">
      <p className="text-xs text-zinc-500">{uses === 0 ? "Unplaced pattern." : `Edits affect ${uses} ${uses === 1 ? "placement" : "placements"} across all tracks.`}</p>
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
      <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={(event) => {
        event.preventDefault();
        if (placePattern(pattern.id, trackId, Number(startBar) - 1) !== null) onClose();
      }}>
        <DestinationTrack pattern={pattern} trackId={trackId} onChange={setTrackId} />
        <label className="block text-xs text-zinc-400">Starting bar
          <input type="number" required min={1} max={256} step={1} value={startBar} onChange={(event) => setStartBar(event.target.value)} />
        </label>
        <button type="submit" disabled={!trackId}>Place pattern</button>
      </form>
      <button type="button" onClick={() => { if (duplicatePattern(pattern.id) !== null) onClose(); }}>Duplicate pattern</button>
      <div className="flex justify-between border-t border-white/10 pt-4">
        <button type="button" className="text-rose-300" onClick={() => setConfirmDelete(true)}>Delete pattern</button>
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </div>}
  </EditorDialog>;
}

export function ClipSettings({ clip, pattern, onClose }: Readonly<{
  clip: ArrangementClip; pattern: Pattern; onClose: () => void;
}>): ReactElement {
  const { project, updateClip, duplicateClip, deleteClip, makeClipUnique } = useStudioStore((state) => state);
  const [trackId, setTrackId] = useState(clip.trackId);
  const [startBar, setStartBar] = useState(String(clip.startBar + 1));
  const [repeatCount, setRepeatCount] = useState(String(clip.repeatCount));
  const uses = project.arrangement.filter((item) => item.patternId === pattern.id).length;
  return <EditorDialog label={`Clip settings for ${pattern.name}`} onClose={onClose}>
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">{pattern.name} · {uses} {uses === 1 ? "placement" : "placements"}. Duplicate clip shares the pattern; Make unique copies its content.</p>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        updateClip(clip.id, { trackId, startBar: Number(startBar) - 1, repeatCount: Number(repeatCount) });
      }}>
        <DestinationTrack pattern={pattern} trackId={trackId} onChange={setTrackId} />
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
        <button type="button" onClick={() => makeClipUnique(clip.id)}>Make unique</button>
      </div>
      <div className="flex justify-between border-t border-white/10 pt-4">
        <button type="button" className="text-rose-300" onClick={() => { deleteClip(clip.id); onClose(); }}>Delete clip</button>
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  </EditorDialog>;
}
