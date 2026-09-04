import assert from "node:assert/strict";
import test from "node:test";

import {
  type Command,
  type Operation,
  type Project,
  ProjectService,
} from "../src/project/index.ts";
import {
  bassTrack,
  blankProject,
  createBassTrackCommand,
  createTestService,
  id,
  projectWithBassAndDrums,
  projectWithBasicDrums,
  updateProjectNameCommand,
} from "./project-fixtures.ts";

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

test("deleting the last clip finalizes its pattern in the same history entry", () => {
  const service = createTestService(projectWithBasicDrums());

  const result = service.dispatch({
    id: "delete-last", source: "manual", label: "Delete clip", kind: "operation",
    operation: { type: "arrangement.delete", clipId: id(12) },
  });

  assert.deepEqual(result.project.patterns, []);
  assert.deepEqual(result.project.arrangement, []);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
  assert.deepEqual(result.historyEntry?.after, result.project);
});

test("deleting one of many shared-pattern clips preserves the pattern", () => {
  const initial = projectWithBasicDrums();
  const service = createTestService({
    ...initial,
    arrangement: [
      ...initial.arrangement,
      { id: id(31), patternId: id(11), trackId: id(10), startBar: 1, repeatCount: 1 },
    ],
  });

  const result = service.dispatch({
    id: "delete-one", source: "manual", label: "Delete clip", kind: "operation",
    operation: { type: "arrangement.delete", clipId: id(12) },
  });

  assert.deepEqual(result.project.patterns.map((pattern) => pattern.id), [id(11)]);
  assert.deepEqual(result.project.arrangement.map((clip) => clip.id), [id(31)]);
  assert.deepEqual(result.changes.deleted.patternIds, []);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
});

test("track deletion finalizes patterns that lose their last placement", () => {
  const service = createTestService(projectWithBasicDrums());

  const result = service.dispatch({
    id: "delete-track", source: "manual", label: "Delete Drums", kind: "operation",
    operation: { type: "track.delete", trackId: id(10) },
  });

  assert.deepEqual(result.project.tracks, []);
  assert.deepEqual(result.project.patterns, []);
  assert.deepEqual(result.project.arrangement, []);
  assert.deepEqual(result.changes.deleted, {
    projectIds: [], trackIds: [id(10)], patternIds: [id(11)], drumHitIds: [id(13)],
    synthNoteIds: [], arrangementClipIds: [id(12)],
  });
});

test("clip pattern reassignment finalizes the previously placed pattern", () => {
  const service = createTestService(projectWithBasicDrums());

  const result = service.dispatch({
    id: "replace-pattern", source: "manual", label: "Replace clip pattern", kind: "batch",
    operations: [
      { type: "pattern.create", pattern: { id: id(30), name: "Fill", kind: "drum", lengthBars: 1, events: [] } },
      { type: "arrangement.update", clipId: id(12), changes: { patternId: id(30) } },
    ],
  });

  assert.deepEqual(result.project.patterns.map((pattern) => pattern.id), [id(30)]);
  assert.deepEqual(result.project.arrangement[0]?.patternId, id(30));
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.updated.arrangementClipIds, [id(12)]);
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
  assert.deepEqual(restored.changes.created.patternIds, [id(21)]);
  assert.deepEqual(restored.changes.created.synthNoteIds, [id(22)]);
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

test("project revision changes once for changed dispatches and not for no-op retries", () => {
  const service = createTestService(blankProject());

  assert.equal(service.getState().revision, 0);
  const created = service.dispatch(createBassTrackCommand(id(700)));
  const batch = service.dispatch({
    id: id(701), source: "manual", label: "Rename and mix", kind: "batch",
    operations: [
      { type: "project.update", changes: { name: "Bass project" } },
      { type: "project.update", changes: { masterVolumeDb: -3 } },
    ],
  });
  const noOp = service.dispatch({
    id: id(702), source: "manual", label: "Keep project", kind: "operation",
    operation: { type: "project.update", changes: {} },
  });
  const retry = service.dispatch(createBassTrackCommand(id(700)));

  assert.equal(created.changed, true);
  assert.equal(batch.changed, true);
  assert.equal(noOp.changed, false);
  assert.equal(retry.deduplicated, true);
  assert.equal(service.getState().revision, 2);
});

test("a net-zero batch does not create history or change revision", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    id: id(703), source: "manual", label: "Rename and restore", kind: "batch",
    operations: [
      { type: "project.update", changes: { name: "Temporary" } },
      { type: "project.update", changes: { name: "Untitled" } },
    ],
  });
  const undone = service.undo();
  const redone = service.redo();

  assert.equal(result.changed, false);
  assert.deepEqual(result.changes, {
    created: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [],
    },
    updated: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [],
    },
    deleted: {
      projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [],
    },
  });
  assert.equal(service.getState().history.length, 0);
  assert.equal(service.getState().historyCursor, -1);
  assert.equal(service.getState().revision, 0);
  assert.equal(undone.ok, false);
  assert.equal(redone.ok, false);
  assert.deepEqual(service.getState().project, blankProject());
});

test("history controls and changed restores each increment revision once", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch(createBassTrackCommand(id(710)));
  if (created.historyEntry === undefined) assert.fail("expected history entry");

  const undone = service.controlHistory({ id: id(711), kind: "undo" });
  const redone = service.controlHistory({ id: id(712), kind: "redo" });
  service.dispatch(updateProjectNameCommand(id(713), "Changed"));
  const restored = service.restore({
    id: id(714), source: "manual", label: "Restore bass", targetEntryId: created.historyEntry.id,
  });

  assert.equal(undone.ok, true);
  assert.equal(redone.ok, true);
  if (undone.ok) assert.deepEqual(undone.changes.deleted.trackIds, [id(20)]);
  if (redone.ok) assert.deepEqual(redone.changes.created.trackIds, [id(20)]);
  assert.equal(restored.changed, true);
  assert.equal(service.getState().revision, 5);
});

test("unavailable controls and no-op or deduplicated restores leave revision unchanged", () => {
  const service = createTestService(blankProject());
  const unavailableUndo = service.controlHistory({ id: id(720), kind: "undo" });
  const created = service.dispatch(createBassTrackCommand(id(721)));
  if (created.historyEntry === undefined) assert.fail("expected history entry");
  const unavailableRedo = service.controlHistory({ id: id(722), kind: "redo" });
  const command = { id: id(723), source: "manual" as const, label: "Keep bass", targetEntryId: created.historyEntry.id };
  const noOp = service.restore(command);
  const retry = service.restore(command);

  assert.equal(unavailableUndo.ok, false);
  assert.equal(unavailableRedo.ok, false);
  assert.equal(noOp.changed, false);
  assert.equal(retry.deduplicated, true);
  assert.equal(service.getState().revision, 1);
});

test("successful history controls deduplicate and failed control IDs remain retryable", () => {
  const service = createTestService(blankProject());
  const unavailable = service.controlHistory({ id: id(730), kind: "undo" });
  service.dispatch(createBassTrackCommand(id(731)));
  const first = service.controlHistory({ id: id(730), kind: "undo" });
  const retry = service.controlHistory({ id: id(730), kind: "undo" });

  assert.equal(unavailable.ok, false);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.deduplicated, true);
  assert.equal(service.getState().historyCursor, -1);
  assert.equal(service.getState().revision, 2);
});

test("agent tool names are retained in serializable dispatch and restore history", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch({ ...createBassTrackCommand(id(740)), source: "agent", toolName: "create_track" });
  if (created.historyEntry === undefined) assert.fail("expected history entry");
  service.dispatch(updateProjectNameCommand(id(741), "Changed"));
  service.restore({
    id: id(742), source: "agent", label: "Restore bass", toolName: "restore_history",
    targetEntryId: created.historyEntry.id,
  });

  const history = service.getState().history;
  assert.equal(history[0]?.toolName, "create_track");
  assert.equal(history[2]?.toolName, "restore_history");
  assert.deepEqual(history, JSON.parse(JSON.stringify(history)));
});

test("replay APIs return retained success outcomes against the current project", () => {
  const service = createTestService(blankProject());
  const created = service.dispatch(createBassTrackCommand(id(750)));
  if (created.historyEntry === undefined) assert.fail("expected history entry");
  service.dispatch(updateProjectNameCommand(id(751), "Changed"));
  service.restore({ id: id(752), source: "manual", label: "Restore bass", targetEntryId: created.historyEntry.id });
  service.dispatch(updateProjectNameCommand(id(753), "Current"));
  const undo = service.controlHistory({ id: id(754), kind: "undo" });
  const currentProject = service.getState().project;
  const dispatchReplay = service.replayDispatch(id(750));
  const restoreReplay = service.replayDispatch(id(752));
  const historyReplay = service.replayHistoryControl(id(754));

  assert.equal(undo.ok, true);
  assert.equal(dispatchReplay?.deduplicated, true);
  assert.equal(restoreReplay?.deduplicated, true);
  assert.equal(historyReplay?.ok, true);
  if (historyReplay?.ok) assert.equal(historyReplay.deduplicated, true);
  assert.equal(dispatchReplay?.project, currentProject);
  assert.equal(restoreReplay?.project, currentProject);
  assert.equal(historyReplay?.project, currentProject);
});

test("successful dispatch and history-control replay caches are bounded", () => {
  const service = createTestService(blankProject());
  const firstDispatchId = id(760);
  assert.equal(service.dispatch(updateProjectNameCommand(firstDispatchId, "Project 0")).ok, true);
  for (let index = 1; index <= 100; index += 1) {
    assert.equal(service.dispatch(updateProjectNameCommand(id(760 + index), `Project ${index}`)).ok, true);
  }

  service.dispatch(createBassTrackCommand(id(870)));
  const firstControlId = id(871);
  for (let index = 0; index <= 100; index += 1) {
    const result = service.controlHistory({ id: id(871 + index), kind: index % 2 === 0 ? "undo" : "redo" });
    assert.equal(result.ok, true);
  }

  assert.equal(service.replayDispatch(firstDispatchId), null);
  assert.equal(service.replayDispatch(id(860))?.deduplicated, true);
  assert.equal(service.replayHistoryControl(firstControlId), null);
  assert.equal(service.replayHistoryControl(id(971))?.ok, true);
});
