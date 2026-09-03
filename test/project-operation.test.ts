import assert from "node:assert/strict";
import test from "node:test";

import { reduceOperation } from "../src/project/index.ts";
import { blankProject, id } from "./project-fixtures.ts";

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
