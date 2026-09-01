import { describe, expect, it } from "vitest";

import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { createStudioStore } from "@/stores/studio-store";

describe("studio session", () => {
  it("completes the silent composition workflow through one project history", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const bassId = store.getState().createTrack("synth", "synth.bass")!;
    const padId = store.getState().createTrack("synth", "synth.pad")!;
    const drumsId = store.getState().createTrack("drum", "kit.basic")!;
    const phraseId = store.getState().createPattern("synth")!;
    const beatId = store.getState().createPatternAt(drumsId, 0)!;

    store.getState().addSynthNote(phraseId, 60, 0, 4);
    store.getState().setDrumCells(beatId, [{ soundId: "kick", startStep: 0, active: true }]);
    const bassClipId = store.getState().placePattern(phraseId, bassId, 0)!;
    const padClipId = store.getState().placePattern(phraseId, padId, 0)!;
    store.getState().makeClipUnique(padClipId);
    const uniquePatternId = store.getState().selectedPatternId!;
    expect(uniquePatternId).not.toBe(phraseId);
    expect(store.getState().project.patterns.find((pattern) => pattern.id === uniquePatternId)?.events)
      .toEqual([expect.objectContaining({ midiNote: 60, startStep: 0, lengthSteps: 4 })]);

    store.getState().updateClip(bassClipId, { startBar: 2 });
    store.getState().reorderTrack(drumsId, 0);
    store.getState().updateClip(bassClipId, { repeatCount: 2 });
    const arrangementEntryId = store.getState().history.at(-1)!.id;
    store.getState().setTrackVolume(bassId, -12);
    store.getState().setTrackPan(padId, 0.5);
    store.getState().setMasterVolume(-3);
    store.getState().undo();
    expect(store.getState().project.masterVolumeDb).toBe(0);
    store.getState().redo();
    expect(store.getState().project.masterVolumeDb).toBe(-3);

    store.getState().restore(arrangementEntryId);
    expect(store.getState().project.masterVolumeDb).toBe(0);
    expect(store.getState().project.tracks[0]?.id).toBe(drumsId);
    expect(store.getState().project.arrangement.find((clip) => clip.id === bassClipId))
      .toMatchObject({ startBar: 2, repeatCount: 2 });
    store.getState().undo();
    expect(store.getState().project.masterVolumeDb).toBe(-3);
  });

  it("stores mixer values in the project and restores them with undo", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const trackId = store.getState().createTrack("synth", "synth.bass")!;
    store.getState().setTrackVolume(trackId, -12);
    store.getState().setTrackPan(trackId, 0.5);
    store.getState().setMasterVolume(-3);
    expect(store.getState().project.tracks[0]).toMatchObject({ volumeDb: -12, pan: 0.5 });
    expect(store.getState().project.masterVolumeDb).toBe(-3);
    store.getState().undo();
    expect(store.getState().project.masterVolumeDb).toBe(0);
  });

  it("rejects invalid mixer values and allows multiple soloed tracks", () => {
    const store = createStudioStore(DEMO_PROJECT);
    const before = store.getState().history.length;
    for (const value of [-61, 7, NaN, Infinity]) store.getState().setTrackVolume("bass", value);
    for (const value of [-1.01, 1.01, NaN, Infinity]) store.getState().setTrackPan("bass", value);
    for (const value of [-61, 1, NaN, Infinity]) store.getState().setMasterVolume(value);
    store.getState().setTrackVolume("missing", -12);
    store.getState().toggleMute("missing");
    store.getState().toggleSolo("missing");
    expect(store.getState().history).toHaveLength(before);
    expect(store.getState().project.tracks.find((track) => track.id === "bass"))
      .toMatchObject({ volumeDb: -9, pan: 0, muted: false, soloed: false });
    expect(store.getState().errorMessage).toBeTruthy();

    store.getState().toggleSolo("bass");
    store.getState().toggleSolo("chords");
    expect(store.getState().project.tracks.filter((track) => track.soloed).map((track) => track.id))
      .toEqual(["bass", "chords"]);
    const changed = store.getState().history.length;
    store.getState().setTrackVolume("bass", -9);
    expect(store.getState().history).toHaveLength(changed);
  });

  it("allows chords but rejects a note extending past its pattern", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const patternId = store.getState().createPattern("synth")!;
    store.getState().addSynthNote(patternId, 60, 0, 4);
    store.getState().addSynthNote(patternId, 64, 0, 4);
    store.getState().addSynthNote(patternId, 67, 0, 4);
    const before = store.getState().history.length;
    expect(store.getState().addSynthNote(patternId, 72, 15, 2)).toBeNull();
    expect(store.getState().project.patterns[0]?.events).toHaveLength(3);
    expect(store.getState().history).toHaveLength(before);
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("accepts the synth-note boundaries and rejects invalid note values", () => {
    const store = createStudioStore({ ...EMPTY_PROJECT, patterns: [
      { id: "melody", name: "Melody", kind: "synth", lengthBars: 1, events: [] },
      { id: "beat", name: "Beat", kind: "drum", lengthBars: 1, events: [] },
    ] });
    expect(store.getState().addSynthNote("melody", 24, 0, 1)).toBeTruthy();
    expect(store.getState().addSynthNote("melody", 96, 15, 1)).toBeTruthy();
    const before = store.getState().history.length;
    for (const [midiNote, startStep, lengthSteps] of [
      [23, 0, 1], [97, 0, 1], [60.5, 0, 1], [60, -1, 1], [60, 1.5, 1],
      [60, 0, 0], [60, 0, -1], [60, 0, 1.5], [60, 15, 2], [NaN, 0, 1], [60, Infinity, 1],
    ]) expect(store.getState().addSynthNote("melody", midiNote!, startStep!, lengthSteps!)).toBeNull();
    expect(store.getState().addSynthNote("beat", 60, 0, 1)).toBeNull();
    expect(store.getState().addSynthNote("gone", 60, 0, 1)).toBeNull();
    expect(store.getState().project.patterns[0]?.events).toHaveLength(2);
    expect(store.getState().history).toHaveLength(before);
  });

  it("updates multiple synth notes atomically and restores them with undo", () => {
    const original = [
      { id: "a", midiNote: 60, startStep: 0, lengthSteps: 4 },
      { id: "b", midiNote: 64, startStep: 4, lengthSteps: 4 },
    ];
    const store = createStudioStore({ ...EMPTY_PROJECT, patterns: [
      { id: "melody", name: "Melody", kind: "synth", lengthBars: 1, events: original },
    ] });
    store.getState().updateSynthNotes("melody", [
      { noteId: "a", changes: { midiNote: 61, startStep: 2 } },
      { noteId: "b", changes: { startStep: 6, lengthSteps: 2 } },
    ]);
    expect(store.getState().project.patterns[0]?.events).toEqual([
      { id: "a", midiNote: 61, startStep: 2, lengthSteps: 4 },
      { id: "b", midiNote: 64, startStep: 6, lengthSteps: 2 },
    ]);
    expect(store.getState().history).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project.patterns[0]?.events).toEqual(original);
    const before = store.getState().history.length;
    store.getState().updateSynthNotes("melody", [
      { noteId: "a", changes: { startStep: 1 } },
      { noteId: "missing", changes: { startStep: 2 } },
    ]);
    expect(store.getState().project.patterns[0]?.events).toEqual(original);
    expect(store.getState().history).toHaveLength(before);
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("duplicates unique synth-note IDs once and rejects overflow or the event cap", () => {
    const notes = [
      { id: "a", midiNote: 60, startStep: 0, lengthSteps: 4 },
      { id: "b", midiNote: 64, startStep: 4, lengthSteps: 4 },
    ];
    const store = createStudioStore({ ...EMPTY_PROJECT, patterns: [
      { id: "melody", name: "Melody", kind: "synth", lengthBars: 1, events: notes },
    ] });
    const duplicateIds = store.getState().duplicateSynthNotes("melody", ["a", "a", "b"], 1, 2);
    const events = store.getState().project.patterns[0]?.events ?? [];
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.id)).size).toBe(4);
    expect(events.slice(2)).toMatchObject([
      { midiNote: 62, startStep: 1, lengthSteps: 4 },
      { midiNote: 66, startStep: 5, lengthSteps: 4 },
    ]);
    expect(duplicateIds).toEqual(events.slice(2).map((event) => event.id));
    expect(store.getState().history).toHaveLength(1);
    store.getState().undo();
    const before = store.getState().history.length;
    expect(store.getState().duplicateSynthNotes("melody", ["b"], 9, 0)).toEqual([]);
    expect(store.getState().duplicateSynthNotes("melody", ["missing"], 1, 0)).toEqual([]);
    expect(store.getState().project.patterns[0]?.events).toEqual(notes);
    expect(store.getState().history).toHaveLength(before);

    const fullStore = createStudioStore({ ...EMPTY_PROJECT, patterns: [
      { id: "full", name: "Full", kind: "synth", lengthBars: 1,
        events: Array.from({ length: 512 }, (_, index) => ({ id: `note-${index}`, midiNote: 60, startStep: 0, lengthSteps: 1 })) },
    ] });
    expect(fullStore.getState().addSynthNote("full", 64, 1, 1)).toBeNull();
    expect(fullStore.getState().duplicateSynthNotes("full", ["note-0"], 1, 0)).toEqual([]);
    expect(fullStore.getState().project.patterns[0]?.events).toHaveLength(512);
    expect(fullStore.getState().history).toHaveLength(0);
  });

  it("deletes synth notes once and edits shared patterns without copying them", () => {
    const store = createStudioStore(DEMO_PROJECT);
    const arrangement = store.getState().project.arrangement;
    const noteId = store.getState().addSynthNote("glasshouse", 72, 31, 1)!;
    expect(store.getState().project.arrangement).toEqual(arrangement);
    expect(store.getState().project.patterns.find((pattern) => pattern.id === "glasshouse")?.events).toHaveLength(7);
    const before = store.getState().history.length;
    store.getState().deleteSynthNotes("glasshouse", [noteId, noteId]);
    expect(store.getState().project.patterns.find((pattern) => pattern.id === "glasshouse")?.events).toHaveLength(6);
    expect(store.getState().history).toHaveLength(before + 1);
    store.getState().undo();
    expect(store.getState().project.patterns.find((pattern) => pattern.id === "glasshouse")?.events).toHaveLength(7);
    store.getState().deleteSynthNotes("glasshouse", ["missing"]);
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("commits a drum paint stroke once and retains edits across selection", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const patternId = store.getState().createPattern("drum")!;
    const before = store.getState().history.length;
    store.getState().setDrumCells(patternId, [
      { soundId: "kick", startStep: 0, active: true },
      { soundId: "kick", startStep: 4, active: true },
    ]);
    const otherId = store.getState().createPattern("drum")!;
    store.getState().selectPattern(otherId);
    store.getState().selectPattern(patternId);
    expect(store.getState().project.patterns.find((pattern) => pattern.id === patternId)?.events).toHaveLength(2);
    expect(store.getState().history).toHaveLength(before + 2);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().project.patterns.find((pattern) => pattern.id === patternId)?.events).toHaveLength(0);
  });

  it("adds and erases drum cells atomically without toggling repeated cells", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const patternId = store.getState().createPattern("drum")!;
    store.getState().setDrumCells(patternId, [
      { soundId: "kick", startStep: 0, active: true },
      { soundId: "kick", startStep: 0, active: true },
      { soundId: "snare", startStep: 4, active: true },
    ]);
    const before = store.getState().history.length;
    store.getState().setDrumCells(patternId, [
      { soundId: "kick", startStep: 0, active: false },
      { soundId: "hat", startStep: 8, active: true },
      { soundId: "kick", startStep: 0, active: false },
    ]);
    const pattern = store.getState().project.patterns.find((item) => item.id === patternId)!;
    expect(pattern.kind).toBe("drum");
    if (pattern.kind !== "drum") throw new Error("Expected a drum pattern");
    expect(pattern.events.map((event) => ({ soundId: event.soundId, startStep: event.startStep }))).toEqual([
      { soundId: "snare", startStep: 4 }, { soundId: "hat", startStep: 8 },
    ]);
    expect(store.getState().history).toHaveLength(before + 1);
    expect(store.getState().history.at(-1)?.action.kind).toBe("batch");
    store.getState().undo();
    expect(store.getState().project.patterns.find((item) => item.id === patternId)?.events).toHaveLength(2);
  });

  it("accepts the final drum step and rejects invalid cells without history", () => {
    const project = { ...EMPTY_PROJECT, patterns: [
      { id: "long-beat", name: "Long beat", kind: "drum" as const, lengthBars: 4 as const, events: [] },
      { id: "unused-synth", name: "Melody", kind: "synth" as const, lengthBars: 1 as const, events: [] },
    ] };
    const store = createStudioStore(project);
    store.getState().setDrumCells("long-beat", [{ soundId: "kick", startStep: 63, active: true }]);
    const before = store.getState().history.length;
    for (const startStep of [-1, 64, 1.5, NaN, Infinity]) {
      store.getState().setDrumCells("long-beat", [{ soundId: "kick", startStep, active: true }]);
    }
    store.getState().setDrumCells("long-beat", [{ soundId: "clap", startStep: 0, active: true }]);
    store.getState().setDrumCells("gone", [{ soundId: "kick", startStep: 0, active: true }]);
    store.getState().setDrumCells("unused-synth", [{ soundId: "kick", startStep: 0, active: true }]);
    expect(store.getState().project.patterns[0]?.events).toHaveLength(1);
    expect(store.getState().history).toHaveLength(before);
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("checks every referencing drum kit before adding a hit", () => {
    const store = createStudioStore({ ...DEMO_PROJECT,
      tracks: [...DEMO_PROJECT.tracks, { ...DEMO_PROJECT.tracks[0]!, id: "other-drums", instrumentId: "missing-kit" }],
      arrangement: [...DEMO_PROJECT.arrangement,
        { id: "other-neon", trackId: "other-drums", patternId: "neon", startBar: 8, repeatCount: 1 }],
    });
    store.getState().setDrumCells("neon", [{ soundId: "kick", startStep: 1, active: true }]);
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().errorMessage).toMatch(/unavailable/i);
    expect(DEMO_PROJECT.patterns[0]?.events).toHaveLength(10);
  });

  it("enforces the drum-event cap while still allowing erasure", () => {
    const events = Array.from({ length: 512 }, (_, index) => ({ id: `hit-${index}`, soundId: "kick", startStep: index % 16 }));
    const store = createStudioStore({ ...EMPTY_PROJECT, patterns: [
      { id: "full-beat", name: "Full beat", kind: "drum", lengthBars: 1, events },
    ] });
    store.getState().setDrumCells("full-beat", [{ soundId: "snare", startStep: 0, active: true }]);
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().errorMessage).toMatch(/512/);
    store.getState().setDrumCells("full-beat", [{ soundId: "kick", startStep: 0, active: false }]);
    expect(store.getState().project.patterns[0]?.events).toHaveLength(480);
    expect(store.getState().history).toHaveLength(1);
  });

  it("assigns new tracks successive wheel colors and wraps to purple", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    for (let index = 0; index < 9; index += 1) store.getState().createTrack("synth", "synth.pad");
    expect(store.getState().project.tracks.map((track) => track.color)).toEqual([
      "#9a69f5", "#d95fc8", "#ef6070", "#f18a4c", "#efbd52", "#70bd72", "#50b8b1", "#598fe3", "#9a69f5",
    ]);
    expect(store.getState().history).toHaveLength(9);
  });

  it("uses the current bottom track color and preserves assignments through edits and history", () => {
    const store = createStudioStore(DEMO_PROJECT);
    const greenId = store.getState().createTrack("synth", "synth.pad")!;
    expect(store.getState().project.tracks.at(-1)?.color).toBe("#70bd72");
    store.getState().renameTrack(greenId, "Layer");
    store.getState().setTrackPreset(greenId, "synth.bass");
    store.getState().reorderTrack("drums", 5);
    const pinkId = store.getState().createTrack("drum", "kit.basic")!;
    expect(store.getState().project.tracks.at(-1)).toMatchObject({ id: pinkId, color: "#d95fc8" });
    expect(store.getState().project.tracks.find((track) => track.id === greenId)?.color).toBe("#70bd72");
    store.getState().undo();
    expect(store.getState().project.tracks.some((track) => track.id === pinkId)).toBe(false);
    store.getState().redo();
    expect(store.getState().project.tracks.at(-1)).toMatchObject({ id: pinkId, color: "#d95fc8" });
    store.getState().deleteTrack(pinkId);
    store.getState().createTrack("synth", "synth.lead");
    expect(store.getState().project.tracks.at(-1)?.color).toBe("#d95fc8");
    expect(store.getState().project.tracks.filter((track) => DEMO_PROJECT.tracks.some((original) => original.id === track.id)))
      .toEqual([...DEMO_PROJECT.tracks.slice(1), DEMO_PROJECT.tracks[0]]);
  });

  it("makes only the chosen clip unique in one undoable entry", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const trackId = store.getState().createTrack("drum", "kit.basic")!;
    const clipId = store.getState().createPatternAt(trackId, 0)!;
    expect(store.getState().history).toHaveLength(2);
    const originalPatternId = store.getState().project.arrangement[0]!.patternId;
    const secondId = store.getState().duplicateClip(clipId)!;
    expect(store.getState().project.arrangement[1]).toMatchObject({ startBar: 1, patternId: originalPatternId });
    const before = store.getState().history.length;
    store.getState().makeClipUnique(secondId);
    expect(store.getState().project.arrangement[0]?.patternId).toBe(originalPatternId);
    expect(store.getState().project.arrangement[1]?.patternId).not.toBe(originalPatternId);
    expect(store.getState().history).toHaveLength(before + 1);
    expect(store.getState().selectedPatternId).toBe(store.getState().project.arrangement[1]?.patternId);
    store.getState().undo();
    expect(store.getState().project.arrangement.every((clip) => clip.patternId === originalPatternId)).toBe(true);
  });

  it("duplicates a pattern as unplaced content with fresh event IDs", () => {
    const store = createStudioStore(DEMO_PROJECT);
    for (const patternId of ["neon", "glasshouse"]) {
      const id = store.getState().duplicatePattern(patternId);
      const copy = store.getState().project.patterns.find((pattern) => pattern.id === id)!;
      const original = DEMO_PROJECT.patterns.find((pattern) => pattern.id === patternId)!;
      expect(copy.events).toEqual(original.events.map((event) => ({ ...event, id: expect.any(String) })));
      expect(copy.events.every((event) => !original.events.some((source) => source.id === event.id))).toBe(true);
      expect(new Set(copy.events.map((event) => event.id)).size).toBe(copy.events.length);
      expect(store.getState().project.arrangement).toEqual(DEMO_PROJECT.arrangement);
      expect(store.getState().selectedClipId).toBeNull();
    }
  });

  it("creates standalone patterns and shares renamed content across tracks", () => {
    const store = createStudioStore(DEMO_PROJECT);
    const id = store.getState().createPattern("synth")!;
    expect(store.getState().project.patterns.at(-1)).toMatchObject({ id, kind: "synth", lengthBars: 1, events: [] });
    const first = store.getState().placePattern(id, "bass", 8)!;
    const second = store.getState().placePattern(id, "chords", 8)!;
    store.getState().renamePattern(id, "  Shared idea  ");
    store.getState().setPatternLength(id, 2);
    expect(store.getState().project.patterns.at(-1)).toMatchObject({ name: "Shared idea", lengthBars: 2 });
    store.getState().updateClip(second, { startBar: 10, trackId: "melody", repeatCount: 2 });
    expect(store.getState()).toMatchObject({ selectedTrackId: "melody", selectedPatternId: id });
    store.getState().deleteClip(first);
    expect(store.getState().project.patterns.some((pattern) => pattern.id === id)).toBe(true);
    const third = store.getState().placePattern(id, "bass", 8)!;
    store.getState().deletePattern(id);
    expect(store.getState().project.arrangement.some((clip) => clip.patternId === id)).toBe(false);
    expect(store.getState().selectedPatternId).toBeNull();
    store.getState().undo();
    expect(store.getState().project.arrangement.some((clip) => clip.id === second)).toBe(true);
    expect(store.getState().project.arrangement.some((clip) => clip.id === third)).toBe(true);
  });

  it("refuses invalid placement, shrink, names, and stale targets without creating history", () => {
    const store = createStudioStore(DEMO_PROJECT);
    const before = store.getState();
    expect(store.getState().createPatternAt("bass", 0)).toBeNull();
    expect(store.getState().duplicateClip("bass-a")).toBeNull();
    expect(store.getState().placePattern("neon", "bass", 8)).toBeNull();
    store.getState().setPatternLength("glasshouse", 1);
    store.getState().setPatternLength("neon", 2);
    store.getState().updateClip("bass-a", { startBar: 1 });
    for (const name of [" ", "x".repeat(41)]) store.getState().renamePattern("neon", name);
    store.getState().renamePattern("neon", "Neon beat");
    store.getState().setPatternLength("neon", 1);
    store.getState().updateClip("bass-a", { startBar: 0 });
    store.getState().createPatternAt("gone", 0);
    store.getState().renamePattern("gone", "Missing");
    store.getState().setPatternLength("gone", 1);
    store.getState().duplicatePattern("gone");
    store.getState().deletePattern("gone");
    store.getState().duplicateClip("gone");
    store.getState().updateClip("gone", { startBar: 1 });
    store.getState().makeClipUnique("gone");
    store.getState().deleteClip("gone");
    expect(store.getState().project).toBe(before.project);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("enforces pattern and clip caps before atomic creation or copying", () => {
    const patterns = Array.from({ length: 128 }, (_, index) => ({ ...DEMO_PROJECT.patterns[0]!, id: `p-${index}` }));
    const store = createStudioStore({ ...DEMO_PROJECT, patterns: [...DEMO_PROJECT.patterns, ...patterns].slice(0, 128) });
    expect(store.getState().createPattern("synth")).toBeNull();
    expect(store.getState().createPatternAt("bass", 8)).toBeNull();
    expect(store.getState().duplicatePattern("neon")).toBeNull();
    store.getState().makeClipUnique("drums-a");
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().project.patterns).toHaveLength(128);
    const full = createStudioStore({ ...DEMO_PROJECT, arrangement: Array.from({ length: 512 }, (_, index) => ({
      ...DEMO_PROJECT.arrangement[0]!, id: `clip-${index}`,
    })) });
    expect(full.getState().placePattern("neon", "drums", 8)).toBeNull();
    expect(full.getState().createPatternAt("drums", 8)).toBeNull();
    expect(full.getState().duplicateClip("clip-0")).toBeNull();
    expect(full.getState().project.patterns).toHaveLength(DEMO_PROJECT.patterns.length);
    expect(full.getState().history).toHaveLength(0);
  });

  it("creates catalog tracks with fresh IDs and undoable defaults", () => {
    const store = createStudioStore(EMPTY_PROJECT);
    const drumId = store.getState().createTrack("drum", "kit.basic");
    const bassId = store.getState().createTrack("synth", "synth.bass");
    expect(drumId).toBeTruthy();
    expect(bassId).not.toBe(drumId);
    expect(store.getState().project.tracks[1]).toEqual({
      id: bassId, name: "Bass", kind: "synth", instrumentId: "synth.bass",
      volumeDb: 0, pan: 0, muted: false, soloed: false, color: "#d95fc8",
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
