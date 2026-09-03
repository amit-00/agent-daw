import assert from "node:assert/strict";
import test from "node:test";

import { type Project, reduceOperation } from "../src/project/index.ts";
import {
  basicDrumTrack,
  blankProject,
  createTestService,
  id,
  projectWithBassAndDrums,
  projectWithBasicDrums,
  projectWithLead,
} from "./project-fixtures.ts";

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

test("track reorder is one undoable project-order change", () => {
  const initial: Project = {
    ...projectWithBassAndDrums(),
    tracks: [...projectWithBassAndDrums().tracks, ...projectWithLead().tracks],
  };
  const service = createTestService(initial);
  const result = service.dispatch({
    id: id(510), source: "manual", label: "Move Drums last", kind: "operation",
    operation: { type: "track.reorder", trackId: id(10), toIndex: 2 },
  });
  assert.deepEqual(result.project.tracks.map((track) => track.id), [id(20), id(40), id(10)]);
  assert.deepEqual(result.project.arrangement, initial.arrangement);
  assert.deepEqual(result.changes.updated.projectIds, [initial.id]);
  assert.deepEqual(result.changes.updated.trackIds, []);
  assert.equal(service.getState().history.length, 1);
  service.undo();
  assert.deepEqual(service.getState().project, initial);
  service.redo();
  assert.deepEqual(service.getState().project, result.project);
  const returned = service.dispatch({
    id: id(511), source: "manual", label: "Move Drums first", kind: "operation",
    operation: { type: "track.reorder", trackId: id(10), toIndex: 0 },
  });
  assert.deepEqual(returned.project, initial);
  service.restore({
    id: id(512), source: "manual", label: "Restore track order", targetEntryId: result.historyEntry!.id,
  });
  assert.deepEqual(service.getState().project, result.project);
  service.undo();
  assert.deepEqual(service.getState().project, initial);
  assert.deepEqual(initial.tracks.map((track) => track.id), [id(10), id(20), id(40)]);
});

test("track reorder leaves an unchanged index out of history", () => {
  const service = createTestService(projectWithBassAndDrums());
  const before = service.getState().project;
  const result = service.dispatch({
    id: id(513), source: "manual", label: "Keep track order", kind: "operation",
    operation: { type: "track.reorder", trackId: id(20), toIndex: 1 },
  });
  assert.equal(result.project, before);
  assert.equal(result.changed, false);
  assert.equal(service.getState().history.length, 0);
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
