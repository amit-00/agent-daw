import { createStore, type StoreApi } from "zustand/vanilla";

import { SOUND_CATALOG } from "@/audio/catalog";
import { INSTRUMENT_NAMES } from "@/data/studio-data";
import { PROJECT_CAPS, ProjectService, type Command, type DispatchResult, type Operation, type Project, type ProjectServiceState, type TrackKind } from "@/project";
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
}

export function createStudioStore(initialProject: Project): StoreApi<StudioState> {
  const service = new ProjectService({
    initialProject, createHistoryId: () => crypto.randomUUID(), now: Date.now,
  });
  return createStore<StudioState>((set, get) => {
    function commit(label: string, operation: Operation): void {
      get().dispatch({ id: crypto.randomUUID(), source: "manual", label, kind: "operation", operation });
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
        commit(`Create ${name}`, { type: "track.create", track: {
          id, name, kind, instrumentId, volumeDb: 0, pan: 0, muted: false, soloed: false,
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
          const kit = SOUND_CATALOG.drumKits.find((item) => item.id === instrumentId)!;
          const placedIds = new Set(project.arrangement.filter((clip) => clip.trackId === trackId).map((clip) => clip.patternId));
          for (const pattern of project.patterns) {
            if (pattern.kind !== "drum" || !placedIds.has(pattern.id)) continue;
            const unavailable = pattern.events.find((hit) => !kit.soundIds.includes(hit.soundId));
            if (unavailable) {
              set({ errorMessage: `This kit lacks ${unavailable.soundId}, used by ${pattern.name}. Choose a compatible kit.` });
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
    };
  });
}
