import assert from "node:assert/strict";
import test from "node:test";

import { type Project, reduceOperation } from "../src/project/index.ts";
import {
  basicDrumTrack,
  blankProject,
  id,
  projectWithBassAndDrums,
  projectWithBasicDrums,
} from "./project-fixtures.ts";

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

test("pattern.create reports drum-hit IDs for embedded events in source order", () => {
  const result = reduceOperation(projectWithBassAndDrums(), {
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

  assert.deepEqual(result.changes.created.drumHitIds, [id(61), id(62)]);
});

test("pattern.create reports synth-note IDs for embedded events in source order", () => {
  const result = reduceOperation(projectWithBassAndDrums(), {
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

  assert.deepEqual(result.changes.created.synthNoteIds, [id(64), id(65)]);
});
