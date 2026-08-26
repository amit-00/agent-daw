import assert from "node:assert/strict";
import test from "node:test";

import {
  ConflictError,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
  type Project,
  type SoundCatalog,
  type Track,
  mergeChangeSummaries,
  reduceOperation,
  summarizeProjectDiff,
  validateProject,
} from "../src/project/index.ts";

const id = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const catalog: SoundCatalog = {
  drumKits: [{ id: "kit.basic", soundIds: ["kick", "snare", "hat"] }],
  synthPresets: [{ id: "synth.bass" }, { id: "synth.lead" }],
};

const blankProject = (): Project => ({
  schemaVersion: 1,
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

const projectWithBasicDrums = (): Project => ({
  ...blankProject(),
  tracks: [basicDrumTrack()],
  patterns: [{
    id: id(11),
    trackId: id(10),
    name: "Beat",
    kind: "drum",
    lengthBars: 1,
    events: [{ id: id(13), soundId: "kick", startStep: 0 }],
  }],
  arrangement: [{ id: id(12), patternId: id(11), startBar: 0, repeatCount: 1 }],
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
      trackId: id(20),
      name: "Bass line",
      kind: "synth",
      lengthBars: 1,
      events: [{ id: id(23), midiNote: 36, startStep: 0, lengthSteps: 4 }],
    },
  ],
  arrangement: [
    ...projectWithBasicDrums().arrangement,
    { id: id(22), patternId: id(21), startBar: 0, repeatCount: 1 },
  ],
});

test("validateProject accepts a blank project", () => {
  assert.doesNotThrow(() => validateProject(blankProject(), catalog));
});

test("validateProject rejects a non-finite BPM with its field path", () => {
  const project = { ...blankProject(), bpm: Number.NaN };

  assert.throws(
    () => validateProject(project, catalog),
    (error: unknown) =>
      error instanceof InvalidInputError && error.info.path === "project.bpm",
  );
});

const invalidProjects: readonly [string, Project, string][] = [
  ["blank name", { ...blankProject(), name: "   " }, "project.name"],
  ["low BPM", { ...blankProject(), bpm: 39 }, "project.bpm"],
  ["high BPM", { ...blankProject(), bpm: 241 }, "project.bpm"],
  ["quiet master", { ...blankProject(), masterVolumeDb: -61 }, "project.masterVolumeDb"],
  ["loud master", { ...blankProject(), masterVolumeDb: 1 }, "project.masterVolumeDb"],
  ["invalid UUID", { ...blankProject(), id: "project-1" }, "project.id"],
];

for (const [name, project, path] of invalidProjects) {
  test(`validateProject rejects ${name}`, () => {
    assert.throws(
      () => validateProject(project, catalog),
      (error: unknown) =>
        error instanceof InvalidInputError && error.info.path === path,
    );
  });
}

test("project.update changes project fields and summarizes the project", () => {
  const project = blankProject();

  const result = reduceOperation(
    project,
    { type: "project.update", changes: { name: "New name", bpm: 100, masterVolumeDb: -3 } },
    catalog,
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

  const result = reduceOperation(project, { type: "project.update", changes: {} }, catalog);

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
    catalog,
  );

  assert.deepEqual(result.project.tracks.map(({ id: trackId }) => trackId), [id(20)]);
  assert.deepEqual(result.changes.created.trackIds, [id(20)]);
});

test("track.create rejects an instrument outside the track kind", () => {
  assert.throws(
    () => reduceOperation(
      blankProject(),
      { type: "track.create", track: { ...basicDrumTrack(), instrumentId: "synth.bass" } },
      catalog,
    ),
    NotFoundError,
  );
});

test("track.create rejects a duplicate track ID", () => {
  assert.throws(
    () => reduceOperation(projectWithBasicDrums(), { type: "track.create", track: basicDrumTrack() }, catalog),
    ConflictError,
  );
});

test("track.create rejects the seventeenth track", () => {
  const project = {
    ...blankProject(),
    tracks: Array.from({ length: 16 }, (_, index): Track => ({
      ...basicDrumTrack(), id: id(index + 30), name: `Drums ${index + 1}`,
    })),
  };

  assert.throws(
    () => reduceOperation(project, { type: "track.create", track: basicDrumTrack() }, catalog),
    LimitExceededError,
  );
});

test("track.update changes mixer fields", () => {
  const result = reduceOperation(
    projectWithBasicDrums(),
    { type: "track.update", trackId: id(10), changes: { name: "Kit", volumeDb: -6, pan: 0.5, muted: true, soloed: true } },
    catalog,
  );

  assert.deepEqual(result.project.tracks[0], {
    ...basicDrumTrack(), name: "Kit", volumeDb: -6, pan: 0.5, muted: true, soloed: true,
  });
  assert.deepEqual(result.changes.updated.trackIds, [id(10)]);
});

test("track.update rejects a kit that cannot play existing hits", () => {
  const project = projectWithBasicDrums();
  const incompatibleCatalog: SoundCatalog = {
    ...catalog,
    drumKits: [...catalog.drumKits, { id: "kit.no-kick", soundIds: ["hat"] }],
  };

  assert.throws(
    () => reduceOperation(
      project,
      { type: "track.update", trackId: id(10), changes: { instrumentId: "kit.no-kick" } },
      incompatibleCatalog,
    ),
    ConflictError,
  );
});

test("track.delete removes its patterns and arrangement clips", () => {
  const project = projectWithBassAndDrums();

  const result = reduceOperation(project, { type: "track.delete", trackId: id(10) }, catalog);

  assert.deepEqual(result.project.tracks.map(({ id: trackId }) => trackId), [id(20)]);
  assert.deepEqual(result.project.patterns.map(({ id: patternId }) => patternId), [id(21)]);
  assert.deepEqual(result.project.arrangement.map(({ id: clipId }) => clipId), [id(22)]);
  assert.deepEqual(result.changes.deleted.trackIds, [id(10)]);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
  assert.equal(project.tracks.length, 2);
});

test("track.delete rejects a missing target", () => {
  assert.throws(
    () => reduceOperation(blankProject(), { type: "track.delete", trackId: id(10) }, catalog),
    NotFoundError,
  );
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
    trackId: id(20),
    name: "First line",
    kind: "synth" as const,
    lengthBars: 1 as const,
    events: [{ id: sharedEventId, midiNote: 36, startStep: 0, lengthSteps: 4 }],
  };
  const secondPattern = {
    id: id(22),
    trackId: id(20),
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
