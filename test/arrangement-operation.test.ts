import assert from "node:assert/strict";
import test from "node:test";

import { type Project, reduceOperation } from "../src/project/index.ts";
import {
  basicDrumTrack,
  createTestService,
  id,
  projectWithBassAndDrums,
  projectWithBasicDrums,
} from "./project-fixtures.ts";

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
