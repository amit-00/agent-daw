import assert from "node:assert/strict";
import test from "node:test";

import {
  type Command,
  type Project,
  ProjectService,
  type Track,
  type Operation,
  mergeChangeSummaries,
  reduceOperation,
  summarizeProjectDiff,
} from "../src/project/index.ts";

const id = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const blankProject = (): Project => ({
  schemaVersion: 2,
  id: id(1),
  name: "Untitled",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [],
  patterns: [],
  arrangement: [],
});

const basicDrumTrack = (): Track => ({
  id: id(10),
  name: "Drums",
  kind: "drum",
  instrumentId: "kit.basic",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

const bassTrack = (): Track => ({
  id: id(20),
  name: "Bass",
  kind: "synth",
  instrumentId: "synth.bass",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

const createBassTrackCommand = (commandId: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: "Create bass",
  operation: { type: "track.create", track: bassTrack() },
});

const updateProjectNameCommand = (commandId: string, name: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: `Rename project to ${name}`,
  operation: { type: "project.update", changes: { name } },
});

const createTestService = (initialProject: Project): ProjectService => {
  let nextHistoryId = 700;
  let timestamp = 1_700_000_000_000;
  return new ProjectService({
    initialProject,
    createHistoryId: () => id(nextHistoryId++),
    now: () => timestamp++,
  });
};

const projectWithBasicDrums = (): Project => ({
  ...blankProject(),
  tracks: [basicDrumTrack()],
  patterns: [{
    id: id(11),
    name: "Beat",
    kind: "drum",
    lengthBars: 1,
    events: [{ id: id(13), soundId: "kick", startStep: 0 }],
  }],
  arrangement: [{ id: id(12), patternId: id(11), trackId: id(10), startBar: 0, repeatCount: 1 }],
});

const projectWithBassAndDrums = (): Project => ({
  ...projectWithBasicDrums(),
  tracks: [
    basicDrumTrack(),
    {
      id: id(20),
      name: "Bass",
      kind: "synth",
      instrumentId: "synth.bass",
      volumeDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
    },
  ],
  patterns: [
    ...projectWithBasicDrums().patterns,
    {
      id: id(21),
      name: "Bass line",
      kind: "synth",
      lengthBars: 1,
      events: [{ id: id(23), midiNote: 36, startStep: 0, lengthSteps: 4 }],
    },
  ],
  arrangement: [
    ...projectWithBasicDrums().arrangement,
    { id: id(22), patternId: id(21), trackId: id(20), startBar: 0, repeatCount: 1 },
  ],
});

const projectWithLead = (): Project => ({
  ...blankProject(),
  tracks: [{
    id: id(40),
    name: "Lead",
    kind: "synth",
    instrumentId: "synth.lead",
    volumeDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
  }],
  patterns: [{
    id: id(41),
    name: "Lead phrase",
    kind: "synth",
    lengthBars: 1,
    events: [{ id: id(42), midiNote: 60, startStep: 0, lengthSteps: 4 }],
  }],
  arrangement: [],
});

test("trusted initial project data is preserved without domain validation", () => {
  const initialProject: Project = { ...blankProject(), id: "project", bpm: 300, name: "" };
  const service = createTestService(initialProject);

  assert.deepEqual(service.getState().project, initialProject);
});

test("trusted commands apply values without domain validation", () => {
  const service = createTestService(projectWithBasicDrums());
  const result = service.dispatch({
    id: "command", source: "manual", label: "", kind: "batch",
    operations: [
      { type: "project.update", changes: { bpm: 300 } },
      { type: "track.update", trackId: id(10), changes: { instrumentId: "kit.custom" } },
      { type: "drum-hits.add", patternId: id(11), hits: [{ id: "hit", soundId: "custom", startStep: 32 }] },
      { type: "arrangement.place", clip: { id: "clip", patternId: id(11), trackId: id(10), startBar: 0, repeatCount: 1 } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.project.bpm, 300);
  assert.equal(result.project.tracks[0]?.instrumentId, "kit.custom");
  assert.deepEqual(result.project.patterns[0]?.events[1], { id: "hit", soundId: "custom", startStep: 32 });
  assert.equal(result.project.arrangement.length, 2);
  assert.equal(service.getState().history.length, 1);
});

test("trusted history metadata and restore snapshots are used directly", () => {
  let nextHistoryId = 0;
  const service = new ProjectService({
    initialProject: blankProject(),
    createHistoryId: () => `history-${nextHistoryId++}`,
    now: () => 1.5,
  });
  const first = service.dispatch(updateProjectNameCommand("first", ""));
  service.dispatch(updateProjectNameCommand("second", "Current"));
  const restored = service.restore({
    id: "restore", source: "manual", label: "", targetEntryId: "history-0",
  });

  assert.equal(first.historyEntry?.createdAt, 1.5);
  assert.equal(restored.project.name, "");
  assert.equal(service.getState().history.length, 3);
});

test("ProjectService detaches its initial project from caller mutation", () => {
  const initialProject = projectWithBasicDrums();
  const expectedProject = structuredClone(initialProject);
  const service = createTestService(initialProject);

  (initialProject as { name: string }).name = "Mutated outside the service";
  (initialProject.tracks[0] as { name: string }).name = "Mutated track";
  (initialProject.patterns[0]!.events[0] as { soundId: string }).soundId = "snare";

  assert.deepEqual(service.getState().project, expectedProject);
  assert.equal(service.getState().history.length, 0);
});

test("ProjectService methods remain callable as callbacks", () => {
  const service = createTestService(blankProject());
  const { dispatch, getState, undo, redo, restore } = service;
  const result = dispatch(createBassTrackCommand(id(100)));

  assert.equal(result.ok, true);
  if (!result.ok || result.historyEntry === undefined) return;
  assert.equal(getState().project.tracks.length, 1);
  assert.equal(undo().ok, true);
  assert.equal(redo().ok, true);
  assert.equal(restore({
    id: id(101),
    source: "manual",
    label: "Restore bass",
    targetEntryId: result.historyEntry.id,
  }).ok, true);
});

test("project.update changes project fields and summarizes the project", () => {
  const project = blankProject();

  const result = reduceOperation(
    project,
    { type: "project.update", changes: { name: "New name", bpm: 100, masterVolumeDb: -3 } },
  );

  assert.deepEqual(
    { name: result.project.name, bpm: result.project.bpm, masterVolumeDb: result.project.masterVolumeDb },
    { name: "New name", bpm: 100, masterVolumeDb: -3 },
  );
  assert.deepEqual(result.changes.updated.projectIds, [id(1)]);
  assert.equal(project.name, "Untitled");
});

test("project.update returns the original project for no changes", () => {
  const project = blankProject();

  const result = reduceOperation(project, { type: "project.update", changes: {} });

  assert.equal(result.project, project);
  assert.deepEqual(result.changes, {
    created: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
      arrangementClipIds: [],
    },
    updated: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
      arrangementClipIds: [],
    },
    deleted: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
      arrangementClipIds: [],
    },
  });
});

test("track.create adds a synth track", () => {
  const result = reduceOperation(
    blankProject(),
    {
      type: "track.create",
      track: {
        id: id(20), name: "Bass", kind: "synth", instrumentId: "synth.bass", volumeDb: 0,
        pan: 0, muted: false, soloed: false,
      },
    },
  );

  assert.deepEqual(result.project.tracks.map(({ id: trackId }) => trackId), [id(20)]);
  assert.deepEqual(result.changes.created.trackIds, [id(20)]);
});

test("track.update changes mixer fields", () => {
  const result = reduceOperation(
    projectWithBasicDrums(),
    { type: "track.update", trackId: id(10), changes: { name: "Kit", volumeDb: -6, pan: 0.5, muted: true, soloed: true } },
  );

  assert.deepEqual(result.project.tracks[0], {
    ...basicDrumTrack(), name: "Kit", volumeDb: -6, pan: 0.5, muted: true, soloed: true,
  });
  assert.deepEqual(result.changes.updated.trackIds, [id(10)]);
});

test("track.delete removes only its track and clips", () => {
  const project = projectWithBassAndDrums();

  const result = reduceOperation(project, { type: "track.delete", trackId: id(10) });

  assert.deepEqual(result.project.tracks.map(({ id: trackId }) => trackId), [id(20)]);
  assert.deepEqual(result.project.patterns, project.patterns);
  assert.deepEqual(result.project.arrangement.map(({ id: clipId }) => clipId), [id(22)]);
  assert.deepEqual(result.changes.deleted.trackIds, [id(10)]);
  assert.deepEqual(result.changes.deleted.patternIds, []);
  assert.deepEqual(result.changes.deleted.drumHitIds, []);
  assert.deepEqual(result.changes.deleted.synthNoteIds, []);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
  assert.equal(project.tracks.length, 2);
});

test("track deletion preserves shared patterns and other-track clips", () => {
  const original = projectWithBasicDrums();
  const project: Project = {
    ...original,
    tracks: [...original.tracks, { ...basicDrumTrack(), id: id(30) }],
    arrangement: [
      ...original.arrangement,
      { id: id(31), patternId: id(11), trackId: id(30), startBar: 0, repeatCount: 1 },
    ],
  };
  const before = structuredClone(project);
  const service = createTestService(project);
  const result = service.dispatch({
    id: id(500), source: "manual", label: "Delete Drums", kind: "operation",
    operation: { type: "track.delete", trackId: id(10) },
  });

  assert.deepEqual(result.project.patterns, project.patterns);
  assert.deepEqual(result.project.arrangement.map((clip) => clip.id), [id(31)]);
  assert.deepEqual(result.changes.deleted, {
    projectIds: [], trackIds: [id(10)], patternIds: [], drumHitIds: [],
    synthNoteIds: [], arrangementClipIds: [id(12)],
  });
  assert.equal(service.getState().history.length, 1);
  service.undo();
  assert.deepEqual(service.getState().project, before);
  service.redo();
  assert.deepEqual(service.getState().project, result.project);
  assert.deepEqual(project, before);
});

test("pattern.create adds an unplaced pattern without tracks", () => {
  const result = reduceOperation(
    blankProject(),
    {
      type: "pattern.create",
      pattern: {
        id: id(30), name: "Fill", kind: "drum", lengthBars: 1, events: [],
      },
    },
  );

  assert.deepEqual(result.project.patterns.map(({ id: patternId }) => patternId), [id(30)]);
  assert.deepEqual(result.project.tracks, []);
  assert.deepEqual(result.project.arrangement, []);
  assert.deepEqual(result.changes.created.patternIds, [id(30)]);
});

test("pattern.duplicate copies content with supplied fresh IDs", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(
    project,
    {
      type: "pattern.duplicate",
      patternId: id(11),
      duplicatePatternId: id(30),
      duplicateName: "Drums copy",
      duplicateEventIds: [id(31)],
    },
  );

  const duplicate = result.project.patterns.find(({ id: patternId }) => patternId === id(30));
  assert.equal(duplicate?.events[0]?.id, id(31));
  assert.equal(duplicate?.events[0]?.startStep, 0);
  assert.deepEqual(result.changes.created.patternIds, [id(30)]);
  assert.deepEqual(result.changes.created.drumHitIds, [id(31)]);
  assert.equal(project.arrangement.length, 1);
  assert.equal(result.project.arrangement.length, 1);
});

test("pattern.update changes only its name and length", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(
    project,
    { type: "pattern.update", patternId: id(11), changes: { name: "Long beat", lengthBars: 2 } },
  );

  assert.deepEqual(result.project.patterns[0], {
    ...project.patterns[0], name: "Long beat", lengthBars: 2,
  });
  assert.deepEqual(result.changes.updated.patternIds, [id(11)]);
  assert.equal(project.patterns[0]?.name, "Beat");
});

test("pattern.update returns the original project for no changes", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "pattern.update", patternId: id(11), changes: {} });

  assert.equal(result.project, project);
  assert.deepEqual(result.changes, {
    created: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
    updated: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
    deleted: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
  });
});

test("pattern.delete removes referencing clips across tracks but preserves tracks", () => {
  const initial = projectWithBassAndDrums();
  const project: Project = {
    ...initial,
    tracks: [...initial.tracks, { ...basicDrumTrack(), id: id(30) }],
    arrangement: [...initial.arrangement,
      { id: id(31), patternId: id(11), trackId: id(30), startBar: 0, repeatCount: 1 }],
  };
  const result = reduceOperation(project, { type: "pattern.delete", patternId: id(11) });

  assert.deepEqual(result.project.tracks, project.tracks);
  assert.deepEqual(result.project.patterns, [project.patterns[1]]);
  assert.deepEqual(result.project.arrangement, [project.arrangement[1]]);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12), id(31)]);
  assert.equal(project.patterns.length, 2);
});

test("arrangement.place allows adjacent clips and overlaps on different tracks", () => {
  const adjacent = reduceOperation(
    projectWithBasicDrums(),
    {
      type: "arrangement.place",
      clip: { id: id(50), patternId: id(11), trackId: id(10), startBar: 1, repeatCount: 1 },
    },
  );
  const overlappingTracks = reduceOperation(
    { ...projectWithBassAndDrums(), arrangement: projectWithBasicDrums().arrangement },
    {
      type: "arrangement.place",
      clip: { id: id(52), patternId: id(21), trackId: id(20), startBar: 0, repeatCount: 1 },
    },
  );

  assert.deepEqual(adjacent.project.arrangement.map(({ id: clipId }) => clipId), [id(12), id(50)]);
  assert.deepEqual(adjacent.changes.created.arrangementClipIds, [id(50)]);
  assert.deepEqual(overlappingTracks.project.arrangement.map(({ id: clipId }) => clipId), [id(12), id(52)]);
  assert.equal(adjacent.project.arrangement[1]?.trackId, id(10));
  assert.equal(overlappingTracks.project.arrangement[1]?.trackId, id(20));
});

test("arrangement.update changes routing without copying or editing the pattern", () => {
  const original = projectWithBasicDrums();
  const project: Project = {
    ...original,
    tracks: [...original.tracks, { ...basicDrumTrack(), id: id(30) }],
  };
  const service = createTestService(project);
  const result = service.dispatch({
    id: id(501), source: "manual", label: "Move clip to another track", kind: "operation",
    operation: { type: "arrangement.update", clipId: id(12), changes: { trackId: id(30) } },
  });

  assert.deepEqual(result.project.arrangement, [{
    id: id(12), patternId: id(11), trackId: id(30), startBar: 0, repeatCount: 1,
  }]);
  assert.deepEqual(result.project.patterns, project.patterns);
  assert.deepEqual(result.changes.updated.arrangementClipIds, [id(12)]);
  assert.deepEqual(result.changes.updated.patternIds, []);
  assert.equal(service.getState().history.length, 1);
  const unchanged = service.dispatch({
    id: id(502), source: "manual", label: "Keep clip track", kind: "operation",
    operation: { type: "arrangement.update", clipId: id(12), changes: { trackId: id(30) } },
  });
  assert.equal(unchanged.changed, false);
  assert.equal(service.getState().history.length, 1);
  service.undo();
  assert.deepEqual(service.getState().project, project);
  service.redo();
  assert.deepEqual(service.getState().project, result.project);
});

test("arrangement.update moves, repeats, and changes its pattern", () => {
  const project: Project = {
    ...projectWithBasicDrums(),
    patterns: [
      ...projectWithBasicDrums().patterns,
      { id: id(30), name: "Fill", kind: "drum", lengthBars: 2, events: [] },
    ],
    arrangement: [
      { id: id(12), patternId: id(11), trackId: id(10), startBar: 0, repeatCount: 1 },
      { id: id(50), patternId: id(11), trackId: id(10), startBar: 2, repeatCount: 1 },
    ],
  };

  const result = reduceOperation(
    project,
    {
      type: "arrangement.update",
      clipId: id(50),
      changes: { patternId: id(30), startBar: 1, repeatCount: 2 },
    },
  );

  assert.deepEqual(result.project.arrangement[1], {
    id: id(50), patternId: id(30), trackId: id(10), startBar: 1, repeatCount: 2,
  });
  assert.deepEqual(result.changes.updated.arrangementClipIds, [id(50)]);
  assert.deepEqual(project.arrangement[1], { id: id(50), patternId: id(11), trackId: id(10), startBar: 2, repeatCount: 1 });
});

test("arrangement.delete removes only the clip", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "arrangement.delete", clipId: id(12) });

  assert.deepEqual(result.project.arrangement, []);
  assert.equal(result.project.patterns.length, 1);
  assert.equal(result.project.tracks.length, 1);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
});

test("drum-hits add, update, and delete change only the target pattern", () => {
  const added = reduceOperation(
    projectWithBasicDrums(),
    { type: "drum-hits.add", patternId: id(11), hits: [{ id: id(30), soundId: "snare", startStep: 4 }] },
  );
  const updated = reduceOperation(
    added.project,
    { type: "drum-hits.update", patternId: id(11), updates: [{ hitId: id(30), changes: { soundId: "hat", startStep: 8 } }] },
  );
  const deleted = reduceOperation(
    updated.project,
    { type: "drum-hits.delete", patternId: id(11), hitIds: [id(30)] },
  );

  assert.deepEqual(added.changes.created.drumHitIds, [id(30)]);
  assert.deepEqual(updated.changes.updated.drumHitIds, [id(30)]);
  assert.deepEqual(updated.project.patterns[0]?.events[1], { id: id(30), soundId: "hat", startStep: 8 });
  assert.deepEqual(deleted.changes.deleted.drumHitIds, [id(30)]);
  assert.deepEqual(deleted.project.patterns[0]?.events.map(({ id: eventId }) => eventId), [id(13)]);
});

test("drum-hits.add preserves identity for empty input", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "drum-hits.add", patternId: id(11), hits: [] });
  assert.equal(result.project, project);
  assert.equal(project.patterns[0]?.events.length, 1);
});

test("synth-notes add, update, and delete change only the target pattern", () => {
  const added = reduceOperation(
    projectWithLead(),
    { type: "synth-notes.add", patternId: id(41), notes: [{ id: id(50), midiNote: 64, startStep: 4, lengthSteps: 4 }] },
  );
  const updated = reduceOperation(
    added.project,
    { type: "synth-notes.update", patternId: id(41), updates: [{ noteId: id(50), changes: { midiNote: 67, startStep: 8, lengthSteps: 2 } }] },
  );
  const deleted = reduceOperation(
    updated.project,
    { type: "synth-notes.delete", patternId: id(41), noteIds: [id(50)] },
  );

  assert.deepEqual(added.changes.created.synthNoteIds, [id(50)]);
  assert.deepEqual(updated.changes.updated.synthNoteIds, [id(50)]);
  assert.deepEqual(updated.project.patterns[0]?.events[1], { id: id(50), midiNote: 67, startStep: 8, lengthSteps: 2 });
  assert.deepEqual(deleted.changes.deleted.synthNoteIds, [id(50)]);
  assert.deepEqual(deleted.project.patterns[0]?.events.map(({ id: eventId }) => eventId), [id(42)]);
});

test("synth-notes.delete preserves identity for empty input", () => {
  const project = projectWithLead();
  const result = reduceOperation(project, { type: "synth-notes.delete", patternId: id(41), noteIds: [] });
  assert.equal(result.project, project);
  assert.equal(project.patterns[0]?.events.length, 1);
});

test("event updates and deletes preserve identity for empty changes", () => {
  const drums = projectWithBasicDrums();
  const lead = projectWithLead();

  assert.equal(
    reduceOperation(
      drums,
      { type: "drum-hits.update", patternId: id(11), updates: [{ hitId: id(13), changes: {} }] },
    ).project,
    drums,
  );
  assert.equal(
    reduceOperation(drums, { type: "drum-hits.delete", patternId: id(11), hitIds: [] }).project,
    drums,
  );
  assert.equal(
    reduceOperation(
      lead,
      { type: "synth-notes.update", patternId: id(41), updates: [{ noteId: id(42), changes: {} }] },
    ).project,
    lead,
  );
  assert.equal(
    reduceOperation(lead, { type: "synth-notes.delete", patternId: id(41), noteIds: [] }).project,
    lead,
  );
});

test("event commands do not mutate their project or operation input", () => {
  const project = projectWithLead();
  const operation = {
    type: "synth-notes.add" as const,
    patternId: id(41),
    notes: [{ id: id(50), midiNote: 64, startStep: 4, lengthSteps: 4 }],
  };
  const originalProject = structuredClone(project);
  const originalOperation = structuredClone(operation);

  reduceOperation(project, operation);

  assert.deepEqual(project, originalProject);
  assert.deepEqual(operation, originalOperation);
});

test("runtime update payloads cannot alter immutable fields", () => {
  const project = projectWithBasicDrums();
  const projectResult = reduceOperation(
    project,
    {
      type: "project.update",
      changes: { name: "Retitled", id: id(90), schemaVersion: 99, tracks: [] },
    } as unknown as Parameters<typeof reduceOperation>[1],
  );
  const trackResult = reduceOperation(
    project,
    {
      type: "track.update",
      trackId: id(10),
      changes: { name: "Renamed", id: id(91), kind: "synth" },
    } as unknown as Parameters<typeof reduceOperation>[1],
  );
  const patternResult = reduceOperation(
    project,
    {
      type: "pattern.update",
      patternId: id(11),
      changes: { name: "Renamed beat", trackId: id(40), kind: "synth", events: [] },
    } as unknown as Parameters<typeof reduceOperation>[1],
  );
  const drumResult = reduceOperation(
    project,
    {
      type: "drum-hits.update",
      patternId: id(11),
      updates: [{ hitId: id(13), changes: { soundId: "snare", id: id(92) } }],
    } as unknown as Parameters<typeof reduceOperation>[1],
  );
  const synthResult = reduceOperation(
    projectWithLead(),
    {
      type: "synth-notes.update",
      patternId: id(41),
      updates: [{ noteId: id(42), changes: { midiNote: 64, id: id(93) } }],
    } as unknown as Parameters<typeof reduceOperation>[1],
  );
  const arrangementResult = reduceOperation(
    project,
    {
      type: "arrangement.update",
      clipId: id(12),
      changes: { startBar: 1, id: id(94) },
    } as unknown as Parameters<typeof reduceOperation>[1],
  );

  assert.deepEqual(
    { id: projectResult.project.id, schemaVersion: projectResult.project.schemaVersion, tracks: projectResult.project.tracks.length },
    { id: id(1), schemaVersion: 2, tracks: 1 },
  );
  assert.deepEqual(
    { id: trackResult.project.tracks[0]?.id, kind: trackResult.project.tracks[0]?.kind, name: trackResult.project.tracks[0]?.name },
    { id: id(10), kind: "drum", name: "Renamed" },
  );
  assert.deepEqual(
    patternResult.project.patterns[0],
    { ...project.patterns[0], name: "Renamed beat" },
  );
  assert.deepEqual(drumResult.project.patterns[0]?.events[0], { id: id(13), soundId: "snare", startStep: 0 });
  assert.deepEqual(synthResult.project.patterns[0]?.events[0], { id: id(42), midiNote: 64, startStep: 0, lengthSteps: 4 });
  assert.deepEqual(arrangementResult.project.arrangement[0], {
    id: id(12), patternId: id(11), trackId: id(10), startBar: 1, repeatCount: 1,
  });
});

test("mergeChangeSummaries deduplicates IDs in first-seen order", () => {
  const result = mergeChangeSummaries([
    {
      created: {
        projectIds: [], trackIds: [id(10), id(20)], patternIds: [], drumHitIds: [],
        synthNoteIds: [], arrangementClipIds: [],
      },
      updated: {
        projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
        arrangementClipIds: [],
      },
      deleted: {
        projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
        arrangementClipIds: [],
      },
    },
    {
      created: {
        projectIds: [], trackIds: [id(20), id(30)], patternIds: [], drumHitIds: [],
        synthNoteIds: [], arrangementClipIds: [],
      },
      updated: {
        projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
        arrangementClipIds: [],
      },
      deleted: {
        projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [],
        arrangementClipIds: [],
      },
    },
  ]);

  assert.deepEqual(result.created.trackIds, [id(10), id(20), id(30)]);
});

test("summarizeProjectDiff preserves entity collection order", () => {
  const before = projectWithBasicDrums();
  const after = projectWithBassAndDrums();

  const result = summarizeProjectDiff(before, after);

  assert.deepEqual(result.created.trackIds, [id(20)]);
  assert.deepEqual(result.created.patternIds, [id(21)]);
  assert.deepEqual(result.created.synthNoteIds, [id(23)]);
  assert.deepEqual(result.created.arrangementClipIds, [id(22)]);
  assert.deepEqual(result.updated.projectIds, [id(1)]);
});

test("summarizeProjectDiff distinguishes same event IDs in separate patterns", () => {
  const sharedEventId = id(23);
  const firstPattern = {
    id: id(21),
    name: "First line",
    kind: "synth" as const,
    lengthBars: 1 as const,
    events: [{ id: sharedEventId, midiNote: 36, startStep: 0, lengthSteps: 4 }],
  };
  const secondPattern = {
    id: id(22),
    name: "Second line",
    kind: "synth" as const,
    lengthBars: 1 as const,
    events: [{ id: sharedEventId, midiNote: 40, startStep: 0, lengthSteps: 4 }],
  };
  const before: Project = {
    ...blankProject(),
    tracks: [{
      id: id(20), name: "Bass", kind: "synth", instrumentId: "synth.bass", volumeDb: 0,
      pan: 0, muted: false, soloed: false,
    }],
    patterns: [firstPattern, secondPattern],
  };
  const after: Project = {
    ...before,
    patterns: [
      firstPattern,
      {
        ...secondPattern,
        events: [{ id: sharedEventId, midiNote: 41, startStep: 0, lengthSteps: 4 }],
      },
    ],
  };

  const result = summarizeProjectDiff(before, after);

  assert.deepEqual(result.updated.synthNoteIds, [sharedEventId]);
});

test("direct dispatch commits one changed operation", () => {
  const service = createTestService(blankProject());

  const result = service.dispatch(createBassTrackCommand(id(100)));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.changed, true);
  assert.equal(result.deduplicated, false);
  assert.deepEqual(result.changes.created.trackIds, [id(20)]);
  assert.equal(result.historyEntry?.id, id(700));
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().history.length, 1);
  assert.equal(service.getState().historyCursor, 0);
});

test("a successful batch dispatch commits merged changes once", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "batch",
    id: id(101),
    source: "agent",
    label: "Build bass line",
    operations: [
      { type: "track.create", track: bassTrack() },
      {
        type: "pattern.create",
        pattern: {
          id: id(21), name: "Bass line", kind: "synth", lengthBars: 1, events: [],
        },
      },
      {
        type: "synth-notes.add",
        patternId: id(21),
        notes: [{ id: id(22), midiNote: 36, startStep: 0, lengthSteps: 4 }],
      },
      {
        type: "arrangement.place",
        clip: { id: id(23), patternId: id(21), trackId: id(20), startBar: 0, repeatCount: 1 },
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.changed, true);
  assert.deepEqual(result.changes.created.trackIds, [id(20)]);
  assert.deepEqual(result.changes.created.patternIds, [id(21)]);
  assert.deepEqual(result.changes.created.synthNoteIds, [id(22)]);
  assert.deepEqual(result.changes.created.arrangementClipIds, [id(23)]);
  assert.equal(service.getState().history.length, 1);
  assert.deepEqual(service.getState().history[0]?.changes, result.changes);
});

test("a failed batch commit leaves state unchanged and its command ID retryable", () => {
  const clockError = new Error("Clock unavailable");
  let clockAvailable = false;
  let nextHistoryId = 0;
  const service = new ProjectService({
    initialProject: blankProject(),
    createHistoryId: () => `history-${nextHistoryId++}`,
    now: () => {
      if (!clockAvailable) throw clockError;
      return 1_700_000_000_000;
    },
  });
  const command: Command = {
    id: "batch", source: "manual", label: "Create and name bass", kind: "batch",
    operations: [
      { type: "track.create", track: bassTrack() },
      { type: "track.update", trackId: id(20), changes: { name: "Named bass" } },
    ],
  };
  const before = structuredClone(service.getState());

  assert.throws(() => service.dispatch(command), (error: unknown) => error === clockError);
  assert.deepEqual(service.getState(), before);

  clockAvailable = true;
  const retried = service.dispatch(command);
  assert.equal(retried.deduplicated, false);
  assert.equal(retried.project.tracks[0]?.name, "Named bass");
  assert.equal(service.getState().history.length, 1);
});

test("repeating a successful command ID returns its outcome without another commit", () => {
  const service = createTestService(blankProject());
  const command = createBassTrackCommand(id(103));

  const first = service.dispatch(command);
  const second = service.dispatch(command);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.deduplicated, true);
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().history.length, 1);
});

test("a no-op dispatch is deduplicated without creating history", () => {
  const service = createTestService(blankProject());
  const command: Command = {
    kind: "operation",
    id: id(104),
    source: "manual",
    label: "Keep project",
    operation: { type: "project.update", changes: {} },
  };

  const first = service.dispatch(command);
  const second = service.dispatch(command);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.equal(first.changed, false);
  if (second.ok) assert.equal(second.deduplicated, true);
  assert.equal(service.getState().history.length, 0);
});

test("a malformed replay returns the retained successful command outcome", () => {
  const service = createTestService(blankProject());
  const first = service.dispatch(createBassTrackCommand(id(142)));
  const replay = service.dispatch({
    id: id(142),
    source: "untrusted",
    label: "",
    kind: "batch",
    operations: null,
  } as unknown as Command);

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.deduplicated, true);
  assert.equal(service.getState().history.length, 1);
  assert.equal(service.getState().project.tracks[0]?.name, "Bass");
});

test("committed history actions are detached and serializable", () => {
  const service = createTestService(blankProject());
  const command: Command = {
    kind: "operation",
    id: id(143),
    source: "manual",
    label: "Rename project",
    operation: {
      type: "project.update",
      changes: { name: "Renamed", ignored: undefined },
    } as unknown as Operation,
  };
  const result = service.dispatch(command);
  (command as unknown as { operation: { changes: { name: string } } }).operation.changes.name = "Mutated after dispatch";

  assert.equal(result.ok, true);
  const action = service.getState().history[0]?.action;
  assert.equal(action?.kind, "operation");
  if (action?.kind === "operation" && action.operation.type === "project.update") {
    assert.equal(action.operation.changes.name, "Renamed");
  }
  assert.doesNotThrow(() => structuredClone(action));
  assert.deepEqual(action, JSON.parse(JSON.stringify(action)));
});

test("dispatch detaches caller-owned created tracks and patterns", () => {
  const service = createTestService(blankProject());
  const callerBass = {
    id: id(20), name: "Bass", kind: "synth" as const, instrumentId: "synth.bass", volumeDb: 0,
    pan: 0, muted: false, soloed: false,
  };
  const callerDrums = {
    id: id(10), name: "Drums", kind: "drum" as const, instrumentId: "kit.basic", volumeDb: 0,
    pan: 0, muted: false, soloed: false,
  };
  const callerBassPattern = {
    id: id(21), name: "Bass line", kind: "synth" as const, lengthBars: 1 as const, events: [],
  };
  const callerDrumPattern = {
    id: id(30), name: "Beat", kind: "drum" as const, lengthBars: 1 as const, events: [],
  };
  const result = service.dispatch({
    kind: "batch",
    id: id(145),
    source: "agent",
    label: "Create tracks and patterns",
    operations: [
      { type: "track.create", track: callerBass },
      { type: "track.create", track: callerDrums },
      { type: "pattern.create", pattern: callerBassPattern },
      { type: "pattern.create", pattern: callerDrumPattern },
    ],
  });
  const state = service.getState();
  const expectedAfter = structuredClone(state.project);

  callerBass.name = "Mutated bass";
  callerDrums.name = "Mutated drums";
  callerBassPattern.name = "Mutated bass pattern";
  callerDrumPattern.name = "Mutated drum pattern";

  assert.equal(result.ok, true);
  assert.deepEqual(service.getState().project, expectedAfter);
  assert.deepEqual(state.history[0]?.after, expectedAfter);
});

test("dispatch detaches caller-owned added events and JSON-round-trips history", () => {
  const service = createTestService(projectWithBassAndDrums());
  const callerHit = { id: id(60), soundId: "snare", startStep: 4 };
  const callerNote = { id: id(61), midiNote: 40, startStep: 4, lengthSteps: 4 };
  const result = service.dispatch({
    kind: "batch",
    id: id(146),
    source: "agent",
    label: "Add bass and drum events",
    operations: [
      { type: "drum-hits.add", patternId: id(11), hits: [callerHit] },
      { type: "synth-notes.add", patternId: id(21), notes: [callerNote] },
    ],
  });
  const state = service.getState();
  const expectedAfter = structuredClone(state.project);
  const entry = state.history[0];

  callerHit.soundId = "hat";
  callerHit.startStep = 8;
  callerNote.midiNote = 48;
  callerNote.startStep = 8;

  assert.equal(result.ok, true);
  assert.deepEqual(service.getState().project, expectedAfter);
  assert.deepEqual(entry?.after, expectedAfter);
  assert.deepEqual(entry, JSON.parse(JSON.stringify(entry)));
});

test("undo and redo replace the project from snapshots", () => {
  const service = createTestService(blankProject());
  service.dispatch(createBassTrackCommand(id(200)));

  const undone = service.undo();
  assert.equal(undone.ok, true);
  assert.equal(service.getState().project.tracks.length, 0);
  assert.equal(service.getState().historyCursor, -1);

  const redone = service.redo();
  assert.equal(redone.ok, true);
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().historyCursor, 0);
});

test("undo and redo boundaries return unavailable without mutation", () => {
  const service = createTestService(blankProject());

  const unavailableUndo = service.undo();
  assert.deepEqual(unavailableUndo, {
    ok: false,
    reason: "nothing_to_undo",
    project: blankProject(),
  });

  service.dispatch(createBassTrackCommand(id(201)));
  const unavailableRedo = service.redo();
  assert.equal(unavailableRedo.ok, false);
  if (!unavailableRedo.ok) assert.equal(unavailableRedo.reason, "nothing_to_redo");
  assert.equal(service.getState().historyCursor, 0);
  assert.equal(service.getState().project.tracks.length, 1);
});

test("a new commit after undo discards the redo branch", () => {
  const service = createTestService(blankProject());
  service.dispatch(createBassTrackCommand(id(202)));
  service.dispatch(updateProjectNameCommand(id(203), "First branch"));
  service.undo();
  service.dispatch(updateProjectNameCommand(id(204), "Second branch"));

  assert.equal(service.getState().history.length, 2);
  assert.equal(service.getState().history[1]?.commandId, id(204));
  assert.equal(service.redo().ok, false);
});

test("restore commits a retained after-snapshot as a new action", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch(createBassTrackCommand(id(205)));
  assert.equal(created.ok, true);
  if (!created.ok || !created.historyEntry) assert.fail("expected history entry");
  const targetEntryId = created.historyEntry.id;
  service.dispatch(updateProjectNameCommand(id(206), "Changed"));

  const restored = service.restore({
    id: id(207),
    source: "manual",
    label: "Restore bass version",
    targetEntryId,
  });

  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.changed, true);
  assert.equal(service.getState().project.name, "Untitled");
  assert.deepEqual(restored.changes.updated.projectIds, [id(1)]);
  assert.deepEqual(service.getState().history.at(-1)?.action, { kind: "restore", targetEntryId });
});

test("restore resolves a target from the redo branch before truncating it", () => {
  const service = createTestService(blankProject());
  service.dispatch(createBassTrackCommand(id(208)));
  const renamed = service.dispatch(updateProjectNameCommand(id(209), "Redo target"));
  assert.equal(renamed.ok, true);
  if (!renamed.ok || !renamed.historyEntry) assert.fail("expected history entry");
  const targetEntryId = renamed.historyEntry.id;
  service.undo();

  const restored = service.restore({
    id: id(210),
    source: "agent",
    label: "Restore redo target",
    targetEntryId,
  });

  assert.equal(restored.ok, true);
  assert.equal(service.getState().project.name, "Redo target");
  assert.equal(service.getState().history.length, 2);
  assert.deepEqual(service.getState().history[1]?.action, { kind: "restore", targetEntryId });
  assert.equal(service.getState().historyCursor, 1);
});

test("restore reports the complete snapshot diff", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch({
    kind: "batch",
    id: id(211),
    source: "agent",
    label: "Build bass phrase",
    operations: [
      { type: "track.create", track: bassTrack() },
      {
        type: "pattern.create",
        pattern: {
          id: id(21), name: "Bass line", kind: "synth", lengthBars: 1, events: [],
        },
      },
      {
        type: "synth-notes.add",
        patternId: id(21),
        notes: [{ id: id(22), midiNote: 36, startStep: 0, lengthSteps: 4 }],
      },
      {
        type: "arrangement.place",
        clip: { id: id(23), patternId: id(21), trackId: id(20), startBar: 0, repeatCount: 1 },
      },
    ],
  });
  assert.equal(created.ok, true);
  if (!created.ok || !created.historyEntry) assert.fail("expected history entry");
  const targetEntryId = created.historyEntry.id;
  service.dispatch({
    kind: "operation",
    id: id(212),
    source: "manual",
    label: "Delete bass",
    operation: { type: "track.delete", trackId: id(20) },
  });

  const restored = service.restore({
    id: id(213), source: "manual", label: "Restore bass phrase", targetEntryId,
  });

  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(restored.changes.created.trackIds, [id(20)]);
  assert.deepEqual(restored.changes.created.patternIds, []);
  assert.deepEqual(restored.changes.created.synthNoteIds, []);
  assert.deepEqual(restored.changes.created.arrangementClipIds, [id(23)]);
});

test("a no-op restore is cached without truncating redo history", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch(createBassTrackCommand(id(219)));
  assert.equal(created.ok, true);
  if (!created.ok || !created.historyEntry) assert.fail("expected history entry");
  service.dispatch({
    kind: "operation",
    id: id(220),
    source: "manual",
    label: "Rename bass",
    operation: { type: "track.update", trackId: id(20), changes: { name: "Changed bass" } },
  });
  service.dispatch({
    kind: "operation",
    id: id(221),
    source: "manual",
    label: "Restore bass name",
    operation: { type: "track.update", trackId: id(20), changes: { name: "Bass" } },
  });
  service.dispatch(updateProjectNameCommand(id(222), "Redo branch"));
  service.undo();
  const command = {
    id: id(223), source: "manual" as const, label: "Keep bass version", targetEntryId: created.historyEntry.id,
  };

  const first = service.restore(command);
  const second = service.restore({
    id: command.id,
    source: "untrusted",
    label: "",
    targetEntryId: id(999),
  } as unknown as Parameters<ProjectService["restore"]>[0]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.equal(first.changed, false);
  if (second.ok) assert.equal(second.deduplicated, true);
  assert.equal(service.getState().history.length, 4);
  assert.equal(service.getState().historyCursor, 2);
});

test("history retention keeps only the 100 newest entries", () => {
  const service = createTestService(blankProject());

  for (let index = 0; index <= 100; index += 1) {
    const result = service.dispatch(updateProjectNameCommand(id(300 + index), `Project ${index}`));
    assert.equal(result.ok, true);
  }

  const state = service.getState();
  assert.equal(state.history.length, 100);
  assert.equal(state.historyCursor, 99);
  assert.equal(state.history[0]?.commandId, id(301));
  assert.equal(state.project.name, "Project 100");
});

test("retention evicts only the oldest successful no-op outcome", () => {
  const service = createTestService(blankProject());
  const noOp = (commandId: string): Command => ({
    kind: "operation",
    id: commandId,
    source: "manual",
    label: "Keep project",
    operation: { type: "project.update", changes: {} },
  });

  for (let index = 0; index <= 100; index += 1) {
    assert.equal(service.dispatch(noOp(id(500 + index))).ok, true);
  }

  const evicted = service.dispatch(noOp(id(500)));
  const retained = service.dispatch(noOp(id(600)));
  assert.equal(evicted.ok, true);
  assert.equal(retained.ok, true);
  if (evicted.ok) assert.equal(evicted.deduplicated, false);
  if (retained.ok) assert.equal(retained.deduplicated, true);
  assert.equal(service.getState().history.length, 0);
  assert.equal(service.getState().historyCursor, -1);
  assert.deepEqual(service.getState().project, blankProject());
});

test("a successful command ID is retried after its 100-outcome cache entry expires", () => {
  const service = createTestService(blankProject());
  const firstCommand: Command = {
    kind: "operation",
    id: id(400),
    source: "manual",
    label: "Name first",
    operation: { type: "project.update", changes: { name: "First" } },
  };
  assert.equal(service.dispatch(firstCommand).ok, true);

  for (let index = 1; index <= 100; index += 1) {
    assert.equal(service.dispatch({
      kind: "operation",
      id: id(400 + index),
      source: "manual",
      label: "Rename project",
      operation: { type: "project.update", changes: { name: `Project ${index}` } },
    }).ok, true);
  }

  const retried = service.dispatch(firstCommand);
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.deduplicated, false);
  assert.equal(service.getState().project.name, "First");
});

test("pattern.create reports IDs for its embedded events in source order", () => {
  const project = projectWithBassAndDrums();
  const drumResult = reduceOperation(project, {
    type: "pattern.create",
    pattern: {
      id: id(60),
      name: "Drum fill",
      kind: "drum",
      lengthBars: 1,
      events: [
        { id: id(61), soundId: "snare", startStep: 4 },
        { id: id(62), soundId: "hat", startStep: 8 },
      ],
    },
  });
  const synthResult = reduceOperation(project, {
    type: "pattern.create",
    pattern: {
      id: id(63),
      name: "Bass variation",
      kind: "synth",
      lengthBars: 1,
      events: [
        { id: id(64), midiNote: 40, startStep: 0, lengthSteps: 4 },
        { id: id(65), midiNote: 43, startStep: 4, lengthSteps: 4 },
      ],
    },
  });

  assert.deepEqual(drumResult.changes.created.drumHitIds, [id(61), id(62)]);
  assert.deepEqual(synthResult.changes.created.synthNoteIds, [id(64), id(65)]);
});

test("mixed event updates report only changed IDs in source order", () => {
  const drumProject: Project = {
    ...projectWithBasicDrums(),
    patterns: [{
      id: id(11),
      name: "Beat",
      kind: "drum",
      lengthBars: 1,
      events: [
        { id: id(13), soundId: "kick", startStep: 0 },
        { id: id(14), soundId: "snare", startStep: 4 },
        { id: id(15), soundId: "hat", startStep: 8 },
      ],
    }],
  };
  const synthProject: Project = {
    ...projectWithLead(),
    patterns: [{
      id: id(41),
      name: "Lead phrase",
      kind: "synth",
      lengthBars: 1,
      events: [
        { id: id(42), midiNote: 60, startStep: 0, lengthSteps: 4 },
        { id: id(43), midiNote: 64, startStep: 4, lengthSteps: 4 },
        { id: id(44), midiNote: 67, startStep: 8, lengthSteps: 4 },
      ],
    }],
  };

  const drumResult = reduceOperation(drumProject, {
    type: "drum-hits.update",
    patternId: id(11),
    updates: [
      { hitId: id(15), changes: { startStep: 12 } },
      { hitId: id(14), changes: { soundId: "snare", startStep: 4 } },
      { hitId: id(13), changes: { soundId: "hat" } },
    ],
  });
  const synthResult = reduceOperation(synthProject, {
    type: "synth-notes.update",
    patternId: id(41),
    updates: [
      { noteId: id(44), changes: { lengthSteps: 2 } },
      { noteId: id(43), changes: { midiNote: 64, startStep: 4, lengthSteps: 4 } },
      { noteId: id(42), changes: { midiNote: 61 } },
    ],
  });

  assert.deepEqual(drumResult.changes.updated.drumHitIds, [id(13), id(15)]);
  assert.deepEqual(synthResult.changes.updated.synthNoteIds, [id(42), id(44)]);
});
