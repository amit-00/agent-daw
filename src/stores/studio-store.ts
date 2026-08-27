import { create } from "zustand";

import { findPatternForClip, getClip, getPattern, PROJECT_PATTERNS } from "@/data/studio-data";
import type { EditorTab, TrackId } from "@/types/studio";

interface StudioState {
  readonly isPlaying: boolean;
  readonly activityOpen: boolean;
  readonly editorTab: EditorTab;
  readonly selectedClipId: string;
  readonly selectedPatternId: string;
  readonly mutedTrackIds: ReadonlySet<TrackId>;
  readonly soloTrackIds: ReadonlySet<TrackId>;
  readonly sequenceSteps: ReadonlySet<number>;
  readonly togglePlayback: () => void;
  readonly stopPlayback: () => void;
  readonly toggleActivity: () => void;
  readonly closeActivity: () => void;
  readonly selectEditorTab: (tab: EditorTab) => void;
  readonly selectClip: (clipId: string) => void;
  readonly selectPattern: (patternId: string) => void;
  readonly toggleMute: (trackId: TrackId) => void;
  readonly toggleSolo: (trackId: TrackId) => void;
  readonly toggleSequenceStep: (step: number) => void;
}

function toggled<T>(values: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

const initialPattern = PROJECT_PATTERNS[4];

export const useStudioStore = create<StudioState>((set) => ({
  isPlaying: false,
  activityOpen: true,
  editorTab: "pattern",
  selectedClipId: initialPattern.clipId,
  selectedPatternId: initialPattern.id,
  mutedTrackIds: new Set(),
  soloTrackIds: new Set(),
  sequenceSteps: new Set(initialPattern.steps),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  stopPlayback: () => set({ isPlaying: false }),
  toggleActivity: () => set((state) => ({ activityOpen: !state.activityOpen })),
  closeActivity: () => set({ activityOpen: false }),
  selectEditorTab: (editorTab) => set({ editorTab }),
  selectClip: (selectedClipId) => set(() => {
    getClip(selectedClipId);
    const pattern = findPatternForClip(selectedClipId);
    return pattern
      ? { selectedClipId, selectedPatternId: pattern.id, sequenceSteps: new Set(pattern.steps) }
      : { selectedClipId };
  }),
  selectPattern: (patternId) => {
    const pattern = getPattern(patternId);
    set({
      selectedPatternId: pattern.id,
      selectedClipId: pattern.clipId,
      sequenceSteps: new Set(pattern.steps),
    });
  },
  toggleMute: (trackId) => set((state) => ({ mutedTrackIds: toggled(state.mutedTrackIds, trackId) })),
  toggleSolo: (trackId) => set((state) => ({ soloTrackIds: toggled(state.soloTrackIds, trackId) })),
  toggleSequenceStep: (step) => set((state) => ({ sequenceSteps: toggled(state.sequenceSteps, step) })),
}));
