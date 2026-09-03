import assert from "node:assert/strict";
import test from "node:test";

import { type Project, reduceOperation } from "../src/project/index.ts";
import { id, projectWithLead } from "./project-fixtures.ts";

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

test("synth-notes.update and delete preserve identity for empty changes", () => {
  const project = projectWithLead();

  assert.equal(
    reduceOperation(
      project,
      { type: "synth-notes.update", patternId: id(41), updates: [{ noteId: id(42), changes: {} }] },
    ).project,
    project,
  );
  assert.equal(
    reduceOperation(project, { type: "synth-notes.delete", patternId: id(41), noteIds: [] }).project,
    project,
  );
});

test("synth-note updates report only changed IDs in source order", () => {
  const project: Project = {
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

  const result = reduceOperation(project, {
    type: "synth-notes.update",
    patternId: id(41),
    updates: [
      { noteId: id(44), changes: { lengthSteps: 2 } },
      { noteId: id(43), changes: { midiNote: 64, startStep: 4, lengthSteps: 4 } },
      { noteId: id(42), changes: { midiNote: 61 } },
    ],
  });

  assert.deepEqual(result.changes.updated.synthNoteIds, [id(42), id(44)]);
});
