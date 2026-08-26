import assert from "node:assert/strict";
import test from "node:test";

import {
  ConflictError,
  type Command,
  createProjectService,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
  type Project,
  type ProjectService,
  type SoundCatalog,
  type Track,
  type Operation,
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

const patternForMissingTrack = () => ({
  id: id(31),
  trackId: id(999),
  name: "Orphan",
  kind: "synth" as const,
  lengthBars: 1 as const,
  events: [],
});

const createBassTrackCommand = (commandId: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: "Create bass",
  operation: { type: "track.create", track: bassTrack() },
});

const createTestService = (initialProject: Project): ProjectService => {
  let nextHistoryId = 700;
  let timestamp = 1_700_000_000_000;
  return createProjectService({
    initialProject,
    catalog,
    createHistoryId: () => id(nextHistoryId++),
    now: () => timestamp++,
  });
};

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

const projectWithAdjacentOneBarClips = (): Project => ({
  ...projectWithBasicDrums(),
  arrangement: [
    { id: id(12), patternId: id(11), startBar: 0, repeatCount: 1 },
    { id: id(51), patternId: id(11), startBar: 1, repeatCount: 1 },
  ],
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
    trackId: id(40),
    name: "Lead phrase",
    kind: "synth",
    lengthBars: 1,
    events: [{ id: id(42), midiNote: 60, startStep: 0, lengthSteps: 4 }],
  }],
  arrangement: [],
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

test("pattern.create adds a pattern with a matching track kind", () => {
  const result = reduceOperation(
    projectWithBasicDrums(),
    {
      type: "pattern.create",
      pattern: {
        id: id(30), trackId: id(10), name: "Fill", kind: "drum", lengthBars: 1, events: [],
      },
    },
    catalog,
  );

  assert.deepEqual(result.project.patterns.map(({ id: patternId }) => patternId), [id(11), id(30)]);
  assert.deepEqual(result.changes.created.patternIds, [id(30)]);
});

test("pattern.create rejects a pattern whose kind differs from its track", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "pattern.create",
        pattern: {
          id: id(30), trackId: id(10), name: "Wrong", kind: "synth", lengthBars: 1, events: [],
        },
      },
      catalog,
    ),
    ConflictError,
  );
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
    catalog,
  );

  const duplicate = result.project.patterns.find(({ id: patternId }) => patternId === id(30));
  assert.equal(duplicate?.trackId, id(10));
  assert.equal(duplicate?.events[0]?.id, id(31));
  assert.equal(duplicate?.events[0]?.startStep, 0);
  assert.deepEqual(result.changes.created.patternIds, [id(30)]);
  assert.deepEqual(result.changes.created.drumHitIds, [id(31)]);
  assert.equal(project.arrangement.length, 1);
  assert.equal(result.project.arrangement.length, 1);
});

test("pattern.duplicate rejects an ID count that differs from copied events", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "pattern.duplicate",
        patternId: id(11), duplicatePatternId: id(30), duplicateName: "Copy", duplicateEventIds: [],
      },
      catalog,
    ),
    InvalidInputError,
  );
});

test("pattern.duplicate rejects duplicate or source event destination IDs", () => {
  const project: Project = {
    ...projectWithBasicDrums(),
    patterns: [{
      id: id(11),
      trackId: id(10),
      name: "Beat",
      kind: "drum",
      lengthBars: 1,
      events: [
        { id: id(13), soundId: "kick", startStep: 0 },
        { id: id(14), soundId: "snare", startStep: 4 },
      ],
    }],
  };

  assert.throws(
    () => reduceOperation(
      project,
      {
        type: "pattern.duplicate",
        patternId: id(11), duplicatePatternId: id(30), duplicateName: "Copy", duplicateEventIds: [id(31), id(31)],
      },
      catalog,
    ),
    InvalidInputError,
  );
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "pattern.duplicate",
        patternId: id(11), duplicatePatternId: id(30), duplicateName: "Copy", duplicateEventIds: [id(13)],
      },
      catalog,
    ),
    InvalidInputError,
  );
});

test("pattern.update changes only its name and length", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(
    project,
    { type: "pattern.update", patternId: id(11), changes: { name: "Long beat", lengthBars: 2 } },
    catalog,
  );

  assert.deepEqual(result.project.patterns[0], {
    ...project.patterns[0], name: "Long beat", lengthBars: 2,
  });
  assert.deepEqual(result.changes.updated.patternIds, [id(11)]);
  assert.equal(project.patterns[0]?.name, "Beat");
});

test("pattern.update returns the original project for no changes", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "pattern.update", patternId: id(11), changes: {} }, catalog);

  assert.equal(result.project, project);
  assert.deepEqual(result.changes, {
    created: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
    updated: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
    deleted: { projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [] },
  });
});

test("pattern.delete removes referencing clips but preserves the track", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "pattern.delete", patternId: id(11) }, catalog);

  assert.equal(result.project.tracks.length, 1);
  assert.equal(result.project.patterns.length, 0);
  assert.equal(result.project.arrangement.length, 0);
  assert.deepEqual(result.changes.deleted.patternIds, [id(11)]);
  assert.deepEqual(result.changes.deleted.drumHitIds, [id(13)]);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
  assert.equal(project.patterns.length, 1);
});

test("arrangement.place allows adjacent clips and overlaps on different tracks", () => {
  const adjacent = reduceOperation(
    projectWithBasicDrums(),
    {
      type: "arrangement.place",
      clip: { id: id(50), patternId: id(11), startBar: 1, repeatCount: 1 },
    },
    catalog,
  );
  const overlappingTracks = reduceOperation(
    { ...projectWithBassAndDrums(), arrangement: projectWithBasicDrums().arrangement },
    {
      type: "arrangement.place",
      clip: { id: id(52), patternId: id(21), startBar: 0, repeatCount: 1 },
    },
    catalog,
  );

  assert.deepEqual(adjacent.project.arrangement.map(({ id: clipId }) => clipId), [id(12), id(50)]);
  assert.deepEqual(adjacent.changes.created.arrangementClipIds, [id(50)]);
  assert.deepEqual(overlappingTracks.project.arrangement.map(({ id: clipId }) => clipId), [id(12), id(52)]);
});

test("arrangement.update moves, repeats, and changes its pattern", () => {
  const project: Project = {
    ...projectWithBasicDrums(),
    patterns: [
      ...projectWithBasicDrums().patterns,
      { id: id(30), trackId: id(10), name: "Fill", kind: "drum", lengthBars: 2, events: [] },
    ],
    arrangement: [
      { id: id(12), patternId: id(11), startBar: 0, repeatCount: 1 },
      { id: id(50), patternId: id(11), startBar: 2, repeatCount: 1 },
    ],
  };

  const result = reduceOperation(
    project,
    {
      type: "arrangement.update",
      clipId: id(50),
      changes: { patternId: id(30), startBar: 1, repeatCount: 2 },
    },
    catalog,
  );

  assert.deepEqual(result.project.arrangement[1], {
    id: id(50), patternId: id(30), startBar: 1, repeatCount: 2,
  });
  assert.deepEqual(result.changes.updated.arrangementClipIds, [id(50)]);
  assert.deepEqual(project.arrangement[1], { id: id(50), patternId: id(11), startBar: 2, repeatCount: 1 });
});

test("arrangement.delete removes only the clip", () => {
  const project = projectWithBasicDrums();
  const result = reduceOperation(project, { type: "arrangement.delete", clipId: id(12) }, catalog);

  assert.deepEqual(result.project.arrangement, []);
  assert.equal(result.project.patterns.length, 1);
  assert.equal(result.project.tracks.length, 1);
  assert.deepEqual(result.changes.deleted.arrangementClipIds, [id(12)]);
});

test("arrangement rejects a missing pattern", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "arrangement.place",
        clip: { id: id(50), patternId: id(99), startBar: 1, repeatCount: 1 },
      },
      catalog,
    ),
    NotFoundError,
  );
});

test("arrangement rejects overlap on the same track", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "arrangement.place",
        clip: { id: id(50), patternId: id(11), startBar: 0, repeatCount: 1 },
      },
      catalog,
    ),
    ConflictError,
  );
});

test("arrangement rejects clips extending past bar 256", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "arrangement.place",
        clip: { id: id(50), patternId: id(11), startBar: 256, repeatCount: 1 },
      },
      catalog,
    ),
    InvalidInputError,
  );
});

test("pattern length update rejects newly overlapping arrangement clips", () => {
  assert.throws(
    () => reduceOperation(
      projectWithAdjacentOneBarClips(),
      { type: "pattern.update", patternId: id(11), changes: { lengthBars: 2 } },
      catalog,
    ),
    (error: unknown) => error instanceof ConflictError && error.info.relatedIds?.length === 2,
  );
});

test("drum-hits add, update, and delete change only the target pattern", () => {
  const added = reduceOperation(
    projectWithBasicDrums(),
    { type: "drum-hits.add", patternId: id(11), hits: [{ id: id(30), soundId: "snare", startStep: 4 }] },
    catalog,
  );
  const updated = reduceOperation(
    added.project,
    { type: "drum-hits.update", patternId: id(11), updates: [{ hitId: id(30), changes: { soundId: "hat", startStep: 8 } }] },
    catalog,
  );
  const deleted = reduceOperation(
    updated.project,
    { type: "drum-hits.delete", patternId: id(11), hitIds: [id(30)] },
    catalog,
  );

  assert.deepEqual(added.changes.created.drumHitIds, [id(30)]);
  assert.deepEqual(updated.changes.updated.drumHitIds, [id(30)]);
  assert.deepEqual(updated.project.patterns[0]?.events[1], { id: id(30), soundId: "hat", startStep: 8 });
  assert.deepEqual(deleted.changes.deleted.drumHitIds, [id(30)]);
  assert.deepEqual(deleted.project.patterns[0]?.events.map(({ id: eventId }) => eventId), [id(13)]);
});

test("drum-hit commands reject synth patterns and duplicate target IDs", () => {
  assert.throws(
    () => reduceOperation(
      projectWithLead(),
      { type: "drum-hits.add", patternId: id(41), hits: [] },
      catalog,
    ),
    ConflictError,
  );
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      {
        type: "drum-hits.delete", patternId: id(11), hitIds: [id(13), id(13)],
      },
      catalog,
    ),
    ConflictError,
  );
});

test("drum-hit multi-event operations are atomic and no-op arrays preserve identity", () => {
  const project = projectWithBasicDrums();
  assert.throws(
    () => reduceOperation(
      project,
      {
        type: "drum-hits.add",
        patternId: id(11),
        hits: [{ id: id(30), soundId: "snare", startStep: 4 }, { id: id(31), soundId: "missing", startStep: 8 }],
      },
      catalog,
    ),
    NotFoundError,
  );
  const result = reduceOperation(project, { type: "drum-hits.add", patternId: id(11), hits: [] }, catalog);
  assert.equal(result.project, project);
  assert.equal(project.patterns[0]?.events.length, 1);
});

test("drum-hits add rejects more than 512 events", () => {
  const hits = Array.from({ length: 512 }, (_, index) => ({
    id: id(index + 30), soundId: "kick", startStep: index % 16,
  }));

  assert.throws(
    () => reduceOperation(projectWithBasicDrums(), { type: "drum-hits.add", patternId: id(11), hits }, catalog),
    LimitExceededError,
  );
});

test("synth-notes add, update, and delete change only the target pattern", () => {
  const added = reduceOperation(
    projectWithLead(),
    { type: "synth-notes.add", patternId: id(41), notes: [{ id: id(50), midiNote: 64, startStep: 4, lengthSteps: 4 }] },
    catalog,
  );
  const updated = reduceOperation(
    added.project,
    { type: "synth-notes.update", patternId: id(41), updates: [{ noteId: id(50), changes: { midiNote: 67, startStep: 8, lengthSteps: 2 } }] },
    catalog,
  );
  const deleted = reduceOperation(
    updated.project,
    { type: "synth-notes.delete", patternId: id(41), noteIds: [id(50)] },
    catalog,
  );

  assert.deepEqual(added.changes.created.synthNoteIds, [id(50)]);
  assert.deepEqual(updated.changes.updated.synthNoteIds, [id(50)]);
  assert.deepEqual(updated.project.patterns[0]?.events[1], { id: id(50), midiNote: 67, startStep: 8, lengthSteps: 2 });
  assert.deepEqual(deleted.changes.deleted.synthNoteIds, [id(50)]);
  assert.deepEqual(deleted.project.patterns[0]?.events.map(({ id: eventId }) => eventId), [id(42)]);
});

test("synth-note update rejects a note ending beyond its pattern", () => {
  const project = projectWithLead();

  assert.throws(
    () => reduceOperation(
      project,
      {
        type: "synth-notes.update",
        patternId: id(41),
        updates: [{ noteId: id(42), changes: { startStep: 15, lengthSteps: 2 } }],
      },
      catalog,
    ),
    InvalidInputError,
  );
});

test("synth-note commands reject drum patterns and duplicate target IDs", () => {
  assert.throws(
    () => reduceOperation(
      projectWithBasicDrums(),
      { type: "synth-notes.add", patternId: id(11), notes: [] },
      catalog,
    ),
    ConflictError,
  );
  assert.throws(
    () => reduceOperation(
      projectWithLead(),
      {
        type: "synth-notes.update",
        patternId: id(41),
        updates: [{ noteId: id(42), changes: {} }, { noteId: id(42), changes: {} }],
      },
      catalog,
    ),
    ConflictError,
  );
});

test("synth-note multi-event operations are atomic and no-op arrays preserve identity", () => {
  const project = projectWithLead();
  assert.throws(
    () => reduceOperation(
      project,
      {
        type: "synth-notes.add",
        patternId: id(41),
        notes: [
          { id: id(50), midiNote: 64, startStep: 4, lengthSteps: 4 },
          { id: id(51), midiNote: 70, startStep: 15, lengthSteps: 2 },
        ],
      },
      catalog,
    ),
    InvalidInputError,
  );
  const result = reduceOperation(project, { type: "synth-notes.delete", patternId: id(41), noteIds: [] }, catalog);
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
      catalog,
    ).project,
    drums,
  );
  assert.equal(
    reduceOperation(drums, { type: "drum-hits.delete", patternId: id(11), hitIds: [] }, catalog).project,
    drums,
  );
  assert.equal(
    reduceOperation(
      lead,
      { type: "synth-notes.update", patternId: id(41), updates: [{ noteId: id(42), changes: {} }] },
      catalog,
    ).project,
    lead,
  );
  assert.equal(
    reduceOperation(lead, { type: "synth-notes.delete", patternId: id(41), noteIds: [] }, catalog).project,
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

  reduceOperation(project, operation, catalog);

  assert.deepEqual(project, originalProject);
  assert.deepEqual(operation, originalOperation);
});

test("runtime update payloads cannot alter immutable fields", () => {
  const project = projectWithBasicDrums();
  const projectResult = reduceOperation(
    project,
    {
      type: "project.update",
      changes: { name: "Retitled", id: id(90), schemaVersion: 2, tracks: [] },
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );
  const trackResult = reduceOperation(
    project,
    {
      type: "track.update",
      trackId: id(10),
      changes: { name: "Renamed", id: id(91), kind: "synth" },
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );
  const patternResult = reduceOperation(
    project,
    {
      type: "pattern.update",
      patternId: id(11),
      changes: { name: "Renamed beat", trackId: id(40), kind: "synth", events: [] },
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );
  const drumResult = reduceOperation(
    project,
    {
      type: "drum-hits.update",
      patternId: id(11),
      updates: [{ hitId: id(13), changes: { soundId: "snare", id: id(92) } }],
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );
  const synthResult = reduceOperation(
    projectWithLead(),
    {
      type: "synth-notes.update",
      patternId: id(41),
      updates: [{ noteId: id(42), changes: { midiNote: 64, id: id(93) } }],
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );
  const arrangementResult = reduceOperation(
    project,
    {
      type: "arrangement.update",
      clipId: id(12),
      changes: { startBar: 1, id: id(94) },
    } as unknown as Parameters<typeof reduceOperation>[1],
    catalog,
  );

  assert.deepEqual(
    { id: projectResult.project.id, schemaVersion: projectResult.project.schemaVersion, tracks: projectResult.project.tracks.length },
    { id: id(1), schemaVersion: 1, tracks: 1 },
  );
  assert.deepEqual(
    { id: trackResult.project.tracks[0]?.id, kind: trackResult.project.tracks[0]?.kind, name: trackResult.project.tracks[0]?.name },
    { id: id(10), kind: "drum", name: "Renamed" },
  );
  assert.deepEqual(
    { trackId: patternResult.project.patterns[0]?.trackId, kind: patternResult.project.patterns[0]?.kind, name: patternResult.project.patterns[0]?.name },
    { trackId: id(10), kind: "drum", name: "Renamed beat" },
  );
  assert.deepEqual(drumResult.project.patterns[0]?.events[0], { id: id(13), soundId: "snare", startStep: 0 });
  assert.deepEqual(synthResult.project.patterns[0]?.events[0], { id: id(42), midiNote: 64, startStep: 0, lengthSteps: 4 });
  assert.deepEqual(arrangementResult.project.arrangement[0], {
    id: id(12), patternId: id(11), startBar: 1, repeatCount: 1,
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
          id: id(21), trackId: id(20), name: "Bass line", kind: "synth", lengthBars: 1, events: [],
        },
      },
      {
        type: "synth-notes.add",
        patternId: id(21),
        notes: [{ id: id(22), midiNote: 36, startStep: 0, lengthSteps: 4 }],
      },
      {
        type: "arrangement.place",
        clip: { id: id(23), patternId: id(21), startBar: 0, repeatCount: 1 },
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

test("a failing batch leaves project and history unchanged", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "batch",
    id: id(102),
    source: "agent",
    label: "Build rhythm section",
    operations: [
      { type: "track.create", track: bassTrack() },
      { type: "pattern.create", pattern: patternForMissingTrack() },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.batchIndex, 1);
  assert.deepEqual(service.getState().project, blankProject());
  assert.equal(service.getState().history.length, 0);
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

test("a rejected command ID can be retried", () => {
  const service = createTestService(blankProject());
  const commandId = id(105);
  const rejected = service.dispatch({
    kind: "operation",
    id: commandId,
    source: "manual",
    label: "Create missing pattern",
    operation: { type: "pattern.create", pattern: patternForMissingTrack() },
  });
  const retried = service.dispatch(createBassTrackCommand(commandId));

  assert.equal(rejected.ok, false);
  assert.equal(retried.ok, true);
  assert.equal(service.getState().project.tracks.length, 1);
  assert.equal(service.getState().history.length, 1);
});

test("a batch dispatch rejects more than 100 operations", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "batch",
    id: id(106),
    source: "agent",
    label: "Too many operations",
    operations: Array.from({ length: 101 }, () => ({ type: "project.update" as const, changes: {} })),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "limit_exceeded");
  assert.equal(service.getState().history.length, 0);
});

test("dispatch rejects malformed runtime command metadata and payload shapes", () => {
  const service = createTestService(blankProject());
  const commands: readonly Command[] = [
    null as unknown as Command,
    {
      kind: "operation",
      id: id(107),
      source: "manual",
      label: "Missing operation",
    } as unknown as Command,
    {
      kind: "operation",
      id: id(108),
      source: "manual",
      label: "Unknown operation",
      operation: { type: "unknown" },
    } as unknown as Command,
    {
      kind: "batch",
      id: id(109),
      source: "agent",
      label: "Missing operations",
      operations: null,
    } as unknown as Command,
  ];

  for (const command of commands) {
    const result = service.dispatch(command);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_input");
  }
  assert.deepEqual(service.getState().project, blankProject());
  assert.equal(service.getState().history.length, 0);
});

test("dispatch rejects malformed nested operation payloads", () => {
  const service = createTestService(blankProject());
  const payloads: readonly unknown[] = [
    { type: "project.update" },
    { type: "track.create", track: null },
    { type: "track.update", trackId: id(20), changes: null },
    { type: "pattern.create", pattern: null },
    { type: "pattern.duplicate", duplicateEventIds: null },
    { type: "pattern.update", patternId: id(21), changes: null },
    { type: "arrangement.place", clip: null },
    { type: "arrangement.update", clipId: id(23), changes: null },
    { type: "drum-hits.add", patternId: id(21), hits: [null] },
    { type: "drum-hits.update", patternId: id(21), updates: [{ hitId: id(22), changes: null }] },
    { type: "drum-hits.delete", patternId: id(21), hitIds: null },
    { type: "synth-notes.add", patternId: id(21), notes: [null] },
    { type: "synth-notes.update", patternId: id(21), updates: [{ noteId: id(22), changes: null }] },
    { type: "synth-notes.delete", patternId: id(21), noteIds: null },
  ];

  for (const [index, operation] of payloads.entries()) {
    const result = service.dispatch({
      kind: "operation",
      id: id(120 + index),
      source: "agent",
      label: "Malformed payload",
      operation: operation as Operation,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_input");
  }
  assert.deepEqual(service.getState().project, blankProject());
  assert.equal(service.getState().history.length, 0);
});

test("dispatch rejects a pattern.create payload with non-array events", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "operation",
    id: id(140),
    source: "agent",
    label: "Malformed pattern",
    operation: {
      type: "pattern.create",
      pattern: {
        id: id(21), trackId: id(20), name: "Bass line", kind: "synth", lengthBars: 1, events: null,
      },
    } as unknown as Operation,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_input");
  assert.deepEqual(service.getState().project, blankProject());
});

test("a malformed second batch member returns its batch index", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "batch",
    id: id(141),
    source: "agent",
    label: "Malformed second operation",
    operations: [
      { type: "project.update", changes: { name: "Changed" } },
      { type: "project.update" } as unknown as Operation,
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.batchIndex, 1);
  assert.deepEqual(service.getState().project, blankProject());
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

test("dispatch rejects a non-serializable operation before committing", () => {
  const service = createTestService(blankProject());
  const result = service.dispatch({
    kind: "operation",
    id: id(144),
    source: "agent",
    label: "Non-serializable operation",
    operation: {
      type: "project.update",
      changes: { name: "Changed", extra: () => undefined },
    } as unknown as Operation,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_input");
  assert.deepEqual(service.getState().project, blankProject());
  assert.equal(service.getState().history.length, 0);
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
    id: id(21), trackId: id(20), name: "Bass line", kind: "synth" as const, lengthBars: 1 as const, events: [],
  };
  const callerDrumPattern = {
    id: id(30), trackId: id(10), name: "Beat", kind: "drum" as const, lengthBars: 1 as const, events: [],
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

test("direct dispatch retains only the 100 newest history entries", () => {
  const service = createTestService(blankProject());

  for (let index = 0; index <= 100; index += 1) {
    const result = service.dispatch({
      kind: "operation",
      id: id(200 + index),
      source: "manual",
      label: "Rename project",
      operation: { type: "project.update", changes: { name: `Project ${index}` } },
    });
    assert.equal(result.ok, true);
  }

  const state = service.getState();
  assert.equal(state.history.length, 100);
  assert.equal(state.historyCursor, 99);
  assert.equal(state.history[0]?.commandId, id(201));
  assert.equal(state.project.name, "Project 100");
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
