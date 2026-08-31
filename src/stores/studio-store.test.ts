import { describe, expect, it } from "vitest";

import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { createStudioStore } from "@/stores/studio-store";

describe("studio session", () => {
  it("creates catalog tracks with fresh IDs and undoable defaults", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const drumId = store.getState().createTrack("drum", "kit.basic");
    const bassId = store.getState().createTrack("synth", "synth.bass");
    expect(drumId).toBeTruthy();
    expect(bassId).not.toBe(drumId);
    expect(store.getState().project.tracks[1]).toEqual({
      id: bassId, name: "Bass", kind: "synth", instrumentId: "synth.bass",
      volumeDb: 0, pan: 0, muted: false, soloed: false,
    });
    expect(store.getState().selectedTrackId).toBe(bassId);
    expect(store.getState().history).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().project.tracks.map((track) => track.id)).toEqual([drumId]);
    store.getState().redo();
    expect(store.getState().project.tracks[1]?.id).toBe(bassId);
    expect(EMPTY_PROJECT.tracks).toHaveLength(0);
  });

  it("refuses wrong-kind instruments and the seventeenth track without history", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    expect(store.getState().createTrack("drum", "synth.bass")).toBeNull();
    expect(store.getState().createTrack("synth", "missing")).toBeNull();
    expect(store.getState().history).toHaveLength(0);
    for (let index = 0; index < 16; index += 1) store.getState().createTrack("synth", "synth.pad");
    expect(store.getState().createTrack("synth", "synth.pad")).toBeNull();
    expect(store.getState().project.tracks).toHaveLength(16);
    expect(store.getState().history).toHaveLength(16);
    expect(store.getState().errorMessage).toMatch(/16/);
  });

  it("trims names, checks presets, and ignores unchanged track edits", () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().renameTrack("bass", "  Sub bass  ");
    store.getState().setTrackPreset("bass", "synth.pad");
    expect(store.getState().project.tracks[1]).toMatchObject({ name: "Sub bass", kind: "synth", instrumentId: "synth.pad" });
    store.getState().renameTrack("bass", "Sub bass");
    store.getState().setTrackPreset("bass", "synth.pad");
    for (const name of [" ", "x".repeat(41)]) store.getState().renameTrack("bass", name);
    store.getState().renameTrack("gone", "Missing");
    store.getState().setTrackPreset("bass", "kit.basic");
    store.getState().setTrackPreset("drums", "synth.bass");
    store.getState().setTrackPreset("gone", "kit.basic");
    expect(store.getState().history).toHaveLength(2);
    expect(store.getState().errorMessage).toBeTruthy();
    store.getState().undo();
    expect(store.getState().project.tracks[1]?.instrumentId).toBe("synth.bass");
  });

  it("checks every placed drum pattern when changing a kit, not unplaced patterns", () => {
    const store = createStudioStore({ ...DEMO_PROJECT,
      tracks: DEMO_PROJECT.tracks.map((track) => track.id === "drums" ? { ...track, instrumentId: "kit.other" } : track),
      patterns: [...DEMO_PROJECT.patterns, { id: "other-beat", name: "Other beat", kind: "drum", lengthBars: 1,
        events: [{ id: "clap", soundId: "clap", startStep: 0 }] }],
      arrangement: [...DEMO_PROJECT.arrangement, { id: "other-clip", trackId: "drums", patternId: "other-beat", startBar: 8, repeatCount: 1 }],
    });
    store.getState().setTrackPreset("drums", "kit.basic");
    expect(store.getState().errorMessage).toMatch(/clap/);
    expect(store.getState().history).toHaveLength(0);
    store.getState().dispatch({ id: "remove-clip", label: "Remove clip", source: "manual", kind: "operation",
      operation: { type: "arrangement.delete", clipId: "other-clip" } });
    store.getState().setTrackPreset("drums", "kit.basic");
    expect(store.getState().project.tracks[0]?.instrumentId).toBe("kit.basic");
    expect(store.getState().history).toHaveLength(2);
  });

  it("reorders once, refuses invalid targets, and deletes clips but retains patterns", () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().reorderTrack("drums", 4);
    expect(store.getState().project.tracks.at(-1)?.id).toBe("drums");
    store.getState().reorderTrack("drums", 4);
    for (const index of [-1, 5, 1.5, NaN, Infinity]) store.getState().reorderTrack("drums", index);
    store.getState().reorderTrack("gone", 0);
    store.getState().deleteTrack("gone");
    expect(store.getState().history).toHaveLength(1);
    store.getState().deleteTrack("drums");
    expect(store.getState().project.arrangement.some((clip) => clip.trackId === "drums")).toBe(false);
    expect(store.getState().project.patterns).toEqual(DEMO_PROJECT.patterns);
    expect(store.getState().history).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().project.arrangement).toEqual(DEMO_PROJECT.arrangement);
    store.getState().undo();
    expect(store.getState().project).toEqual(DEMO_PROJECT);
  });

  it("publishes committed history without leaking between studio sessions", () => {
    const first = createStudioStore(EMPTY_PROJECT);
    const second = createStudioStore(EMPTY_PROJECT);
    first.getState().dispatch({
      id: "rename", source: "manual", label: "Rename project", kind: "operation",
      operation: { type: "project.update", changes: { name: "Changed" } },
    });
    expect(first.getState().project.name).toBe("Changed");
    expect(first.getState().history).toHaveLength(1);
    expect(second.getState().project).toEqual(EMPTY_PROJECT);
    first.getState().undo();
    expect(first.getState().project).toEqual(EMPTY_PROJECT);
    first.getState().redo();
    expect(first.getState().project.name).toBe("Changed");
  });

  it("selects clips with their routing but library patterns without invented track context", () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().selectClip("chords-b");
    expect(store.getState()).toMatchObject({
      selectedClipId: "chords-b", selectedPatternId: "glasshouse", selectedTrackId: "chords",
    });
    store.getState().selectPattern("unused-idea");
    expect(store.getState()).toMatchObject({
      selectedPatternId: "unused-idea", selectedClipId: null, selectedTrackId: null,
    });
    store.getState().selectTrack("bass");
    expect(store.getState()).toMatchObject({
      selectedTrackId: "bass", selectedPatternId: null, selectedClipId: null,
    });
    expect(store.getState().history).toHaveLength(0);
  });

  it("reconciles routing and removes stale selections after commits and undo", () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().selectClip("bass-a");
    store.getState().dispatch({
      id: "move", source: "agent", label: "Move bass phrase", kind: "operation",
      operation: { type: "arrangement.update", clipId: "bass-a", changes: { trackId: "melody" } },
    });
    expect(store.getState().selectedTrackId).toBe("melody");
    store.getState().undo();
    expect(store.getState().selectedTrackId).toBe("bass");
    store.getState().dispatch({
      id: "delete", source: "manual", label: "Delete bass", kind: "operation",
      operation: { type: "track.delete", trackId: "bass" },
    });
    expect(store.getState()).toMatchObject({
      selectedTrackId: null, selectedClipId: null, selectedPatternId: "orbit",
    });
    store.getState().dispatch({
      id: "delete-pattern", source: "manual", label: "Delete phrase", kind: "operation",
      operation: { type: "pattern.delete", patternId: "orbit" },
    });
    expect(store.getState().selectedPatternId).toBeNull();
  });

  it("handles empty sessions and stale selection requests without history", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    store.getState().undo();
    store.getState().redo();
    store.getState().selectClip("gone");
    store.getState().selectTrack("gone");
    store.getState().selectPattern("gone");
    expect(store.getState()).toMatchObject({
      selectedClipId: null, selectedTrackId: null, selectedPatternId: null,
      project: EMPTY_PROJECT, history: [], historyCursor: -1,
    });
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("restores real snapshots and refuses a missing history target", () => {
    const store = createStudioStore(DEMO_PROJECT);
    store.getState().dispatch({
      id: "rename", source: "agent", label: "Agent renamed song", kind: "operation",
      operation: { type: "project.update", changes: { name: "New song" } },
    });
    const entryId = store.getState().history[0]!.id;
    store.getState().dispatch({
      id: "idea", source: "manual", label: "Create idea", kind: "operation",
      operation: { type: "pattern.create", pattern: {
        id: "new-idea", name: "New idea", kind: "synth", lengthBars: 1, events: [],
      } },
    });
    store.getState().selectPattern("new-idea");
    store.getState().restore(entryId);
    expect(store.getState().selectedPatternId).toBeNull();
    expect(store.getState().history[0]?.source).toBe("agent");
    expect(store.getState().history.at(-1)?.action.kind).toBe("restore");
    store.getState().undo();
    expect(store.getState().project.patterns.at(-1)?.id).toBe("new-idea");
    const before = store.getState();
    store.getState().restore("missing-entry");
    expect(store.getState().project).toBe(before.project);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().errorMessage).toMatch(/no longer available/i);
  });
});
