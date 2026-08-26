import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidInputError,
  type Project,
  type SoundCatalog,
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
