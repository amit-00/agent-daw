import { createStore, type StoreApi } from "zustand/vanilla";

import { SOUND_CATALOG } from "@/audio/catalog";
import { getTrackColor, INSTRUMENT_NAMES, TRACK_COLOR_WHEEL } from "@/data/studio-data";
import { PROJECT_CAPS, ProjectService, type Command, type DispatchResult, type Operation, type Pattern, type PatternLengthBars, type Project, type ProjectServiceState, type TrackKind } from "@/project";
import { getDrumKitProblem, getPatternLengthProblem, getPlacementProblem } from "@/stores/studio-edits";
import type { EditorTab } from "@/types/studio";

export interface StudioState extends ProjectServiceState {
  readonly activityOpen: boolean;
  readonly editorTab: EditorTab;
  readonly selectedClipId: string | null;
  readonly selectedPatternId: string | null;
  readonly selectedTrackId: string | null;
  readonly errorMessage: string | null;
  dispatch(command: Command): DispatchResult;
  undo(): void;
  redo(): void;
  restore(entryId: string): void;
  toggleActivity(): void;
  closeActivity(): void;
  selectEditorTab(tab: EditorTab): void;
  selectClip(clipId: string): void;
  selectPattern(patternId: string): void;
  selectTrack(trackId: string): void;
  createTrack(kind: TrackKind, instrumentId: string): string | null;
  renameTrack(trackId: string, name: string): void;
  setTrackPreset(trackId: string, instrumentId: string): void;
  reorderTrack(trackId: string, toIndex: number): void;
  deleteTrack(trackId: string): void;
  createPattern(kind: TrackKind): string | null;
  createPatternAt(trackId: string, startBar: number): string | null;
  placePattern(patternId: string, trackId: string, startBar: number): string | null;
  renamePattern(patternId: string, name: string): void;
  setPatternLength(patternId: string, lengthBars: PatternLengthBars): void;
  duplicatePattern(patternId: string): string | null;
  deletePattern(patternId: string): void;
  updateClip(clipId: string, changes: Extract<Operation, { type: "arrangement.update" }>["changes"]): void;
  duplicateClip(clipId: string): string | null;
  deleteClip(clipId: string): void;
  makeClipUnique(clipId: string): void;
}

function duplicatePatternOperation(pattern: Pattern, id: string): Operation {
  return { type: "pattern.duplicate", patternId: pattern.id, duplicatePatternId: id,
    duplicateName: `${pattern.name.slice(0, 35)} copy`, duplicateEventIds: pattern.events.map(() => crypto.randomUUID()) };
}

export function createStudioStore(initialProject: Project): StoreApi<StudioState> {
  const service = new ProjectService({
    initialProject, createHistoryId: () => crypto.randomUUID(), now: Date.now,
  });
  return createStore<StudioState>((set, get) => {
    function commit(label: string, operation: Operation): void {
      get().dispatch({ id: crypto.randomUUID(), source: "manual", label, kind: "operation", operation });
    }

    function commitBatch(label: string, operations: readonly Operation[]): void {
      get().dispatch({ id: crypto.randomUUID(), source: "manual", label, kind: "batch", operations });
    }

    function publish(): void {
      const snapshot = service.getState();
      const { project } = snapshot;
      const selection = get();
      const clip = project.arrangement.find((item) => item.id === selection.selectedClipId);
      const patternId = clip?.patternId ?? selection.selectedPatternId;
      const trackId = clip?.trackId ?? selection.selectedTrackId;
      set({
        ...snapshot,
        selectedClipId: clip?.id ?? null,
        selectedPatternId: project.patterns.some((item) => item.id === patternId) ? patternId : null,
        selectedTrackId: project.tracks.some((item) => item.id === trackId) ? trackId : null,
        errorMessage: null,
      });
    }
    const snapshot = service.getState();
    const firstClip = snapshot.project.arrangement[0];
    return {
      ...snapshot,
      activityOpen: true, editorTab: "pattern", errorMessage: null,
      selectedClipId: firstClip?.id ?? null,
      selectedPatternId: firstClip?.patternId ?? snapshot.project.patterns[0]?.id ?? null,
      selectedTrackId: firstClip?.trackId ?? null,
      dispatch(command): DispatchResult {
        const result = service.dispatch(command);
        publish();
        return result;
      },
      undo(): void { service.undo(); publish(); },
      redo(): void { service.redo(); publish(); },
      restore(entryId): void {
        if (!get().history.some((entry) => entry.id === entryId)) {
          set({ errorMessage: "That history entry is no longer available. Choose a retained entry." });
          return;
        }
        service.restore({
          id: crypto.randomUUID(), source: "manual", label: "Restore history", targetEntryId: entryId,
        });
        publish();
      },
      toggleActivity: () => set((state) => ({ activityOpen: !state.activityOpen })),
      closeActivity: () => set({ activityOpen: false }),
      selectEditorTab: (editorTab) => set({ editorTab }),
      selectClip(clipId): void {
        const clip = get().project.arrangement.find((item) => item.id === clipId);
        set({
          selectedClipId: clip?.id ?? null, selectedPatternId: clip?.patternId ?? null,
          selectedTrackId: clip?.trackId ?? null, editorTab: "pattern",
          errorMessage: clip ? null : "That clip no longer exists. Select another clip.",
        });
      },
      selectPattern(patternId): void {
        const exists = get().project.patterns.some((item) => item.id === patternId);
        set({
          selectedPatternId: exists ? patternId : null, selectedClipId: null, selectedTrackId: null,
          editorTab: "pattern", errorMessage: exists ? null : "That pattern no longer exists. Select another pattern.",
        });
      },
      selectTrack(trackId): void {
        const exists = get().project.tracks.some((item) => item.id === trackId);
        set({
          selectedTrackId: exists ? trackId : null, selectedClipId: null, selectedPatternId: null,
          errorMessage: exists ? null : "That track no longer exists. Select another track.",
        });
      },
      createTrack(kind, instrumentId): string | null {
        if (get().project.tracks.length >= PROJECT_CAPS.maxTracks) {
          set({ errorMessage: `A project supports ${PROJECT_CAPS.maxTracks} tracks. Delete a track before adding another.` });
          return null;
        }
        const instruments = kind === "drum" ? SOUND_CATALOG.drumKits : SOUND_CATALOG.synthPresets;
        if (!instruments.some((instrument) => instrument.id === instrumentId)) {
          set({ errorMessage: `Choose an available ${kind} instrument.` });
          return null;
        }
        const id = crypto.randomUUID();
        const name = INSTRUMENT_NAMES[instrumentId] ?? instrumentId;
        const lastTrack = get().project.tracks.at(-1);
        const colorIndex = lastTrack ? (TRACK_COLOR_WHEEL.indexOf(getTrackColor(lastTrack)) + 1) % TRACK_COLOR_WHEEL.length : 0;
        commit(`Create ${name}`, { type: "track.create", track: {
          id, name, kind, instrumentId, volumeDb: 0, pan: 0, muted: false, soloed: false,
          color: TRACK_COLOR_WHEEL[colorIndex]!,
        } });
        get().selectTrack(id);
        return id;
      },
      renameTrack(trackId, name): void {
        const track = get().project.tracks.find((item) => item.id === trackId);
        if (!track) {
          set({ errorMessage: "That track no longer exists. Select another track." });
          return;
        }
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > 40) {
          set({ errorMessage: "Track names must contain 1–40 characters after trimming spaces." });
          return;
        }
        commit(`Rename ${track.name} to ${trimmed}`, { type: "track.update", trackId, changes: { name: trimmed } });
      },
      setTrackPreset(trackId, instrumentId): void {
        const { project } = get();
        const track = project.tracks.find((item) => item.id === trackId);
        if (!track) {
          set({ errorMessage: "That track no longer exists. Select another track." });
          return;
        }
        const instruments = track.kind === "drum" ? SOUND_CATALOG.drumKits : SOUND_CATALOG.synthPresets;
        if (!instruments.some((instrument) => instrument.id === instrumentId)) {
          set({ errorMessage: `Choose an available ${track.kind} instrument.` });
          return;
        }
        if (track.kind === "drum") {
          const placedIds = new Set(project.arrangement.filter((clip) => clip.trackId === trackId).map((clip) => clip.patternId));
          for (const pattern of project.patterns) {
            if (pattern.kind !== "drum" || !placedIds.has(pattern.id)) continue;
            const problem = getDrumKitProblem({ ...track, instrumentId }, pattern.events.map((hit) => hit.soundId));
            if (problem) {
              set({ errorMessage: problem });
              return;
            }
          }
        }
        commit(`Change ${track.name} instrument`, { type: "track.update", trackId, changes: { instrumentId } });
      },
      reorderTrack(trackId, toIndex): void {
        const { tracks } = get().project;
        const track = tracks.find((item) => item.id === trackId);
        if (!track || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= tracks.length) {
          set({ errorMessage: "That track position is no longer available. Choose a position in the current track list." });
          return;
        }
        commit(`Move ${track.name} to track ${toIndex + 1}`, { type: "track.reorder", trackId, toIndex });
      },
      deleteTrack(trackId): void {
        const track = get().project.tracks.find((item) => item.id === trackId);
        if (!track) {
          set({ errorMessage: "That track no longer exists. Select another track." });
          return;
        }
        commit(`Delete ${track.name}`, { type: "track.delete", trackId });
      },
      createPattern(kind): string | null {
        if (get().project.patterns.length >= PROJECT_CAPS.maxPatterns) {
          set({ errorMessage: `A project supports ${PROJECT_CAPS.maxPatterns} patterns. Delete one before creating another.` });
          return null;
        }
        const id = crypto.randomUUID();
        const name = kind === "drum" ? "New beat" : "New melody";
        commit(`Create ${name}`, { type: "pattern.create", pattern: { id, name, kind, lengthBars: 1, events: [] } });
        get().selectPattern(id);
        return id;
      },
      createPatternAt(trackId, startBar): string | null {
        const { project } = get();
        const track = project.tracks.find((item) => item.id === trackId);
        if (!track) {
          set({ errorMessage: "That track no longer exists. Select another track." });
          return null;
        }
        if (project.patterns.length >= PROJECT_CAPS.maxPatterns || project.arrangement.length >= PROJECT_CAPS.maxArrangementClips) {
          set({ errorMessage: `Creation needs a free pattern and clip slot (${PROJECT_CAPS.maxPatterns} patterns / ${PROJECT_CAPS.maxArrangementClips} clips maximum). Delete an unused item first.` });
          return null;
        }
        const pattern: Pattern = { id: crypto.randomUUID(), name: track.kind === "drum" ? "New beat" : "New melody",
          kind: track.kind, lengthBars: 1, events: [] };
        const clip = { id: crypto.randomUUID(), patternId: pattern.id, trackId, startBar, repeatCount: 1 };
        const problem = getPlacementProblem({ ...project, patterns: [...project.patterns, pattern] }, clip);
        if (problem) { set({ errorMessage: problem }); return null; }
        commitBatch(`Create ${pattern.name} on ${track.name}`, [{ type: "pattern.create", pattern }, { type: "arrangement.place", clip }]);
        get().selectClip(clip.id);
        return clip.id;
      },
      placePattern(patternId, trackId, startBar): string | null {
        const { project } = get();
        if (project.arrangement.length >= PROJECT_CAPS.maxArrangementClips) {
          set({ errorMessage: `A project supports ${PROJECT_CAPS.maxArrangementClips} clips. Delete one before placing another.` });
          return null;
        }
        const clip = { id: crypto.randomUUID(), patternId, trackId, startBar, repeatCount: 1 };
        const problem = getPlacementProblem(project, clip);
        if (problem) { set({ errorMessage: problem }); return null; }
        const pattern = project.patterns.find((item) => item.id === patternId)!;
        commit(`Place ${pattern.name} at bar ${startBar + 1}`, { type: "arrangement.place", clip });
        get().selectClip(clip.id);
        return clip.id;
      },
      renamePattern(patternId, name): void {
        const pattern = get().project.patterns.find((item) => item.id === patternId);
        if (!pattern) { set({ errorMessage: "That pattern no longer exists. Select another pattern." }); return; }
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > 40) {
          set({ errorMessage: "Pattern names must contain 1–40 characters after trimming spaces." });
          return;
        }
        commit(`Rename ${pattern.name} to ${trimmed}`, { type: "pattern.update", patternId, changes: { name: trimmed } });
      },
      setPatternLength(patternId, lengthBars): void {
        const { project } = get();
        const problem = getPatternLengthProblem(project, patternId, lengthBars);
        if (problem) { set({ errorMessage: problem }); return; }
        const pattern = project.patterns.find((item) => item.id === patternId)!;
        commit(`Set ${pattern.name} to ${lengthBars} bars`, { type: "pattern.update", patternId, changes: { lengthBars } });
      },
      duplicatePattern(patternId): string | null {
        const { project } = get();
        const pattern = project.patterns.find((item) => item.id === patternId);
        if (!pattern) { set({ errorMessage: "That pattern no longer exists. Select another pattern." }); return null; }
        if (project.patterns.length >= PROJECT_CAPS.maxPatterns) {
          set({ errorMessage: `A project supports ${PROJECT_CAPS.maxPatterns} patterns. Delete one before duplicating.` });
          return null;
        }
        const id = crypto.randomUUID();
        commit(`Duplicate ${pattern.name}`, duplicatePatternOperation(pattern, id));
        get().selectPattern(id);
        return id;
      },
      deletePattern(patternId): void {
        const pattern = get().project.patterns.find((item) => item.id === patternId);
        if (!pattern) { set({ errorMessage: "That pattern no longer exists. Select another pattern." }); return; }
        commit(`Delete ${pattern.name} and its placements`, { type: "pattern.delete", patternId });
      },
      updateClip(clipId, changes): void {
        const { project } = get();
        const clip = project.arrangement.find((item) => item.id === clipId);
        if (!clip) { set({ errorMessage: "That clip no longer exists. Select another clip." }); return; }
        const problem = getPlacementProblem(project, { ...clip, ...changes });
        if (problem) { set({ errorMessage: problem }); return; }
        const pattern = project.patterns.find((item) => item.id === clip.patternId)!;
        commit(`Update ${pattern.name} placement`, { type: "arrangement.update", clipId, changes });
      },
      duplicateClip(clipId): string | null {
        const { project } = get();
        const clip = project.arrangement.find((item) => item.id === clipId);
        if (!clip) { set({ errorMessage: "That clip no longer exists. Select another clip." }); return null; }
        if (project.arrangement.length >= PROJECT_CAPS.maxArrangementClips) {
          set({ errorMessage: `A project supports ${PROJECT_CAPS.maxArrangementClips} clips. Delete one before duplicating.` });
          return null;
        }
        const pattern = project.patterns.find((item) => item.id === clip.patternId)!;
        const copy = { ...clip, id: crypto.randomUUID(), startBar: clip.startBar + pattern.lengthBars * clip.repeatCount };
        const problem = getPlacementProblem(project, copy);
        if (problem) { set({ errorMessage: problem }); return null; }
        commit(`Duplicate ${pattern.name} clip`, { type: "arrangement.place", clip: copy });
        get().selectClip(copy.id);
        return copy.id;
      },
      deleteClip(clipId): void {
        const { project } = get();
        const clip = project.arrangement.find((item) => item.id === clipId);
        if (!clip) { set({ errorMessage: "That clip no longer exists. Select another clip." }); return; }
        const pattern = project.patterns.find((item) => item.id === clip.patternId)!;
        commit(`Delete ${pattern.name} clip`, { type: "arrangement.delete", clipId });
      },
      makeClipUnique(clipId): void {
        const { project } = get();
        const clip = project.arrangement.find((item) => item.id === clipId);
        if (!clip) { set({ errorMessage: "That clip no longer exists. Select another clip." }); return; }
        if (project.patterns.length >= PROJECT_CAPS.maxPatterns) {
          set({ errorMessage: `Making a clip unique needs a free pattern slot (${PROJECT_CAPS.maxPatterns} maximum). Delete an unused pattern first.` });
          return;
        }
        const pattern = project.patterns.find((item) => item.id === clip.patternId)!;
        const id = crypto.randomUUID();
        commitBatch(`Make ${pattern.name} unique`, [duplicatePatternOperation(pattern, id),
          { type: "arrangement.update", clipId, changes: { patternId: id } }]);
      },
    };
  });
}
