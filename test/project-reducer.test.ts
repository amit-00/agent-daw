import assert from "node:assert/strict";
import test from "node:test";

import { type Operation, type Project, mergeChangeSummaries, reduceOperation, summarizeProjectDiff } from "../src/project/index.ts";
import {
  blankProject,
  id,
  projectWithBassAndDrums,
  projectWithBasicDrums,
  projectWithLead,
} from "./project-fixtures.ts";

test("reduceOperation rejects an unsupported operation type", () => {
  const operation = { type: "unsupported" } as unknown as Operation;

  assert.throws(
    () => reduceOperation(blankProject(), operation),
    new Error("Unsupported project operation: unsupported"),
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

test("runtime updates cannot alter immutable project, track, pattern, or arrangement fields", () => {
  const project = projectWithBasicDrums();
  const projectResult = reduceOperation(project, {
    type: "project.update",
    changes: { name: "Retitled", id: id(90), schemaVersion: 99, tracks: [] },
  } as unknown as Parameters<typeof reduceOperation>[1]);
  const trackResult = reduceOperation(project, {
    type: "track.update",
    trackId: id(10),
    changes: { name: "Renamed", id: id(91), kind: "synth" },
  } as unknown as Parameters<typeof reduceOperation>[1]);
  const patternResult = reduceOperation(project, {
    type: "pattern.update",
    patternId: id(11),
    changes: { name: "Renamed beat", trackId: id(40), kind: "synth", events: [] },
  } as unknown as Parameters<typeof reduceOperation>[1]);
  const arrangementResult = reduceOperation(project, {
    type: "arrangement.update",
    clipId: id(12),
    changes: { startBar: 1, id: id(94) },
  } as unknown as Parameters<typeof reduceOperation>[1]);

  assert.deepEqual(
    { id: projectResult.project.id, schemaVersion: projectResult.project.schemaVersion, tracks: projectResult.project.tracks.length },
    { id: id(1), schemaVersion: 2, tracks: 1 },
  );
  assert.deepEqual(
    { id: trackResult.project.tracks[0]?.id, kind: trackResult.project.tracks[0]?.kind, name: trackResult.project.tracks[0]?.name },
    { id: id(10), kind: "drum", name: "Renamed" },
  );
  assert.deepEqual(patternResult.project.patterns[0], { ...project.patterns[0], name: "Renamed beat" });
  assert.deepEqual(arrangementResult.project.arrangement[0], {
    id: id(12), patternId: id(11), trackId: id(10), startBar: 1, repeatCount: 1,
  });
});

test("runtime drum-hit updates cannot alter immutable fields", () => {
  const result = reduceOperation(projectWithBasicDrums(), {
    type: "drum-hits.update",
    patternId: id(11),
    updates: [{ hitId: id(13), changes: { soundId: "snare", id: id(92) } }],
  } as unknown as Parameters<typeof reduceOperation>[1]);

  assert.deepEqual(result.project.patterns[0]?.events[0], { id: id(13), soundId: "snare", startStep: 0 });
});

test("runtime synth-note updates cannot alter immutable fields", () => {
  const result = reduceOperation(projectWithLead(), {
    type: "synth-notes.update",
    patternId: id(41),
    updates: [{ noteId: id(42), changes: { midiNote: 64, id: id(93) } }],
  } as unknown as Parameters<typeof reduceOperation>[1]);

  assert.deepEqual(result.project.patterns[0]?.events[0], { id: id(42), midiNote: 64, startStep: 0, lengthSteps: 4 });
});
