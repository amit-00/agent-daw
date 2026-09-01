import { describe, expect, it } from "vitest";

import { EMPTY_PROJECT } from "@/data/studio-data";
import type { ArrangementClip, Project } from "@/project";
import { getPatternLengthProblem, getPlacementProblem } from "@/stores/studio-edits";

const project: Project = {
  ...EMPTY_PROJECT,
  tracks: [
    { id: "a", name: "Bass", kind: "synth", instrumentId: "synth.bass", volumeDb: 0, pan: 0, muted: false, soloed: false },
    { id: "b", name: "Pad", kind: "synth", instrumentId: "synth.pad", volumeDb: 0, pan: 0, muted: false, soloed: false },
    { id: "d", name: "Drums", kind: "drum", instrumentId: "kit.basic", volumeDb: 0, pan: 0, muted: false, soloed: false },
  ],
  patterns: [{ id: "p", name: "Phrase", kind: "synth", lengthBars: 1, events: [] }],
  arrangement: [{ id: "original", patternId: "p", trackId: "a", startBar: 1, repeatCount: 2 }],
};
const candidate: ArrangementClip = { id: "new", patternId: "p", trackId: "a", startBar: 3, repeatCount: 1 };

describe("placement constraints", () => {
  it.each([
    { changes: { startBar: 0 }, valid: true },
    { changes: { startBar: 3 }, valid: true },
    { changes: { startBar: 2 }, valid: false },
    { changes: { startBar: 1, trackId: "b" }, valid: true },
    { changes: { startBar: 1, id: "original" }, valid: true },
    { changes: { trackId: "d" }, valid: false },
    { changes: { trackId: "gone" }, valid: false },
    { changes: { patternId: "gone" }, valid: false },
    { changes: { startBar: -1 }, valid: false },
    { changes: { startBar: 0.5 }, valid: false },
    { changes: { startBar: NaN }, valid: false },
    { changes: { startBar: Infinity }, valid: false },
    { changes: { startBar: 255 }, valid: true },
    { changes: { startBar: 256 }, valid: false },
    { changes: { repeatCount: 64 }, valid: true },
    { changes: { repeatCount: 65 }, valid: false },
    { changes: { repeatCount: 0 }, valid: false },
    { changes: { repeatCount: 1.5 }, valid: false },
    { changes: { repeatCount: NaN }, valid: false },
  ])("checks $changes", ({ changes, valid }) => {
    expect(getPlacementProblem(project, { ...candidate, ...changes }) === null).toBe(valid);
  });

  it("rejects drum content missing from the destination kit", () => {
    const drums: Project = { ...project, patterns: [{ id: "p", name: "Beat", kind: "drum", lengthBars: 1,
      events: [{ id: "hit", soundId: "clap", startStep: 0 }] }] };
    expect(getPlacementProblem(drums, { ...candidate, trackId: "d" })).toMatch(/clap/);
    expect(getPlacementProblem({ ...drums, tracks: drums.tracks.map((track) => ({ ...track, instrumentId: "missing" })) },
      { ...candidate, trackId: "d" })).toMatch(/kit/i);
  });

  it("checks proposed length against every shared placement, including other references to itself", () => {
    const shared: Project = { ...project, arrangement: [
      { ...candidate, id: "first", startBar: 0 }, { ...candidate, id: "second", startBar: 1 },
    ] };
    expect(getPatternLengthProblem(shared, "p", 2)).toMatch(/overlap/i);
    expect(getPatternLengthProblem(project, "p", 4)).toBeNull();
    expect(getPatternLengthProblem({ ...project, arrangement: [{ ...candidate, startBar: 255 }] }, "p", 2)).toMatch(/256/);
  });

  it("allows exactly 64 repeats of a four-bar pattern within the arrangement", () => {
    const longPattern: Project = { ...project,
      patterns: [{ ...project.patterns[0]!, lengthBars: 4 }], arrangement: [] };
    expect(getPlacementProblem(longPattern, { ...candidate, startBar: 0, repeatCount: 64 })).toBeNull();
    expect(getPlacementProblem(longPattern, { ...candidate, startBar: 1, repeatCount: 64 })).toMatch(/256/);
  });

  it("refuses to truncate hits or note durations on shrink", () => {
    expect(getPatternLengthProblem({ ...project, patterns: [{ id: "p", name: "Notes", kind: "synth", lengthBars: 2,
      events: [{ id: "note", midiNote: 60, startStep: 15, lengthSteps: 2 }] }] }, "p", 1)).toMatch(/shorten/i);
    expect(getPatternLengthProblem({ ...project, patterns: [{ id: "p", name: "Beat", kind: "drum", lengthBars: 2,
      events: [{ id: "hit", soundId: "kick", startStep: 16 }] }] }, "p", 1)).toMatch(/shorten|remove/i);
    expect(getPatternLengthProblem(project, "gone", 1)).toMatch(/no longer exists/i);
  });
});
