import assert from "node:assert/strict";
import test from "node:test";

import { type Project, reduceOperation } from "../src/project/index.ts";
import { id, projectWithBasicDrums } from "./project-fixtures.ts";

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

test("drum-hits.update and delete preserve identity for empty changes", () => {
  const project = projectWithBasicDrums();

  assert.equal(
    reduceOperation(
      project,
      { type: "drum-hits.update", patternId: id(11), updates: [{ hitId: id(13), changes: {} }] },
    ).project,
    project,
  );
  assert.equal(
    reduceOperation(project, { type: "drum-hits.delete", patternId: id(11), hitIds: [] }).project,
    project,
  );
});

test("drum-hit updates report only changed IDs in source order", () => {
  const project: Project = {
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

  const result = reduceOperation(project, {
    type: "drum-hits.update",
    patternId: id(11),
    updates: [
      { hitId: id(15), changes: { startStep: 12 } },
      { hitId: id(14), changes: { soundId: "snare", startStep: 4 } },
      { hitId: id(13), changes: { soundId: "hat" } },
    ],
  });

  assert.deepEqual(result.changes.updated.drumHitIds, [id(13), id(15)]);
});
