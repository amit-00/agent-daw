import { describe, expect, it } from "vitest";

import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { createStudioStore } from "@/stores/studio-store";

describe("studio session", () => {
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
