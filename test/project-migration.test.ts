import assert from "node:assert/strict";
import test from "node:test";

import { migrateProject, type Project, type ProjectV1 } from "../src/project/index.ts";

const legacy: ProjectV1 = {
  schemaVersion: 1, id: "project", name: "Old song", bpm: 118, masterVolumeDb: -3,
  tracks: [
    { id: "bass", name: "Bass", kind: "synth", instrumentId: "synth.bass",
      volumeDb: -9, pan: -0.25, muted: true, soloed: false },
    { id: "drums", name: "Drums", kind: "drum", instrumentId: "kit.basic",
      volumeDb: -6, pan: 0.5, muted: false, soloed: true },
  ],
  patterns: [
    { id: "beat", trackId: "drums", name: "Beat", kind: "drum", lengthBars: 1,
      events: [{ id: "kick", soundId: "kick", startStep: 0 }] },
    { id: "line", trackId: "bass", name: "Line", kind: "synth", lengthBars: 2,
      events: [{ id: "note", midiNote: 36, startStep: 4, lengthSteps: 8 }] },
    { id: "fill", trackId: "drums", name: "Unused fill", kind: "drum", lengthBars: 4,
      events: [{ id: "snare", soundId: "snare", startStep: 63 }] },
    { id: "chord", trackId: "bass", name: "Unused chord", kind: "synth", lengthBars: 1,
      events: [
        { id: "root", midiNote: 60, startStep: 0, lengthSteps: 4 },
        { id: "third", midiNote: 64, startStep: 0, lengthSteps: 4 },
      ] },
  ],
  arrangement: [
    { id: "clip", patternId: "beat", startBar: 2, repeatCount: 3 },
    { id: "repeat", patternId: "beat", startBar: 6, repeatCount: 2 },
    { id: "bass-clip", patternId: "line", startBar: 1, repeatCount: 4 },
  ],
};

test("migration moves track ownership without changing the legacy project", () => {
  const before = structuredClone(legacy);
  const converted = migrateProject(legacy);

  assert.deepEqual(converted, {
    ...legacy,
    schemaVersion: 2,
    patterns: [
      { id: "beat", name: "Beat", kind: "drum", lengthBars: 1,
        events: [{ id: "kick", soundId: "kick", startStep: 0 }] },
      { id: "line", name: "Line", kind: "synth", lengthBars: 2,
        events: [{ id: "note", midiNote: 36, startStep: 4, lengthSteps: 8 }] },
      { id: "fill", name: "Unused fill", kind: "drum", lengthBars: 4,
        events: [{ id: "snare", soundId: "snare", startStep: 63 }] },
      { id: "chord", name: "Unused chord", kind: "synth", lengthBars: 1,
        events: [
          { id: "root", midiNote: 60, startStep: 0, lengthSteps: 4 },
          { id: "third", midiNote: 64, startStep: 0, lengthSteps: 4 },
        ] },
    ],
    arrangement: [
      { id: "clip", patternId: "beat", trackId: "drums", startBar: 2, repeatCount: 3 },
      { id: "repeat", patternId: "beat", trackId: "drums", startBar: 6, repeatCount: 2 },
      { id: "bass-clip", patternId: "line", trackId: "bass", startBar: 1, repeatCount: 4 },
    ],
  });
  assert.deepEqual(legacy, before);
});

test("migration passes schema 2 through unchanged", () => {
  const project: Project = {
    schemaVersion: 2, id: "current", name: "Current song", bpm: 120, masterVolumeDb: 0,
    tracks: [], patterns: [], arrangement: [],
  };

  assert.equal(migrateProject(project), project);
});

test("migration rejects a missing legacy pattern without losing the original", () => {
  const broken: ProjectV1 = {
    ...legacy,
    arrangement: [...legacy.arrangement,
      { id: "dangling-clip", patternId: "missing-beat", startBar: 10, repeatCount: 1 }],
  };
  const before = structuredClone(broken);

  assert.throws(() => migrateProject(broken), {
    name: "RangeError", message: /dangling-clip.*missing-beat.*missing/,
  });
  assert.deepEqual(broken, before);
});
