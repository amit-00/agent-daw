import { beforeEach, describe, expect, it } from "vitest";

import { PROJECT_PATTERNS } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-store";

describe("studio store", () => {
  beforeEach(() => {
    useStudioStore.setState(useStudioStore.getInitialState(), true);
  });

  it("controls playback without an effect", () => {
    useStudioStore.getState().togglePlayback();
    expect(useStudioStore.getState().isPlaying).toBe(true);

    useStudioStore.getState().stopPlayback();
    expect(useStudioStore.getState().isPlaying).toBe(false);
  });

  it("selects a pattern and its associated clip atomically", () => {
    const pattern = PROJECT_PATTERNS[6];

    useStudioStore.getState().selectPattern(pattern.id);

    const state = useStudioStore.getState();
    expect(state.selectedPatternId).toBe(pattern.id);
    expect(state.selectedClipId).toBe(pattern.clipId);
    expect([...state.sequenceSteps]).toEqual(pattern.steps);
  });

  it("updates mute, solo, and sequence sets immutably", () => {
    const initialMuted = useStudioStore.getState().mutedTrackIds;

    useStudioStore.getState().toggleMute("drums");
    useStudioStore.getState().toggleSolo("bass");
    useStudioStore.getState().toggleSequenceStep(3);

    const state = useStudioStore.getState();
    expect(state.mutedTrackIds).not.toBe(initialMuted);
    expect(state.mutedTrackIds.has("drums")).toBe(true);
    expect(state.soloTrackIds.has("bass")).toBe(true);
    expect(state.sequenceSteps.has(3)).toBe(true);
  });
});
