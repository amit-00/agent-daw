import { createStore, type StoreApi } from "zustand/vanilla";

import { ProjectService, type Command, type DispatchResult, type Project, type ProjectServiceState } from "@/project";
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
}

export function createStudioStore(initialProject: Project): StoreApi<StudioState> {
  const service = new ProjectService({
    initialProject, createHistoryId: () => crypto.randomUUID(), now: Date.now,
  });
  return createStore<StudioState>((set, get) => {
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
    };
  });
}
