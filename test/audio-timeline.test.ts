import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangementEndStep,
  audioTimeForStep,
  expandTimeline,
  playbackFingerprint,
  positionAtAudioTime,
  secondsPerStep,
} from "../src/audio/index.ts";
import type { Project } from "../src/project/index.ts";
import { audioProject } from "./audio-fixtures.ts";

test("timing maps steps to the audio clock at the project BPM", () => {
  assert.equal(secondsPerStep(120), 0.125);
  assert.equal(audioTimeForStep(12, 4, 10, 120), 11);
  assert.equal(positionAtAudioTime(4, 10, 11, 120), 12);
  assert.equal(positionAtAudioTime(4, 10, 9, 120), 4);
  assert.throws(() => secondsPerStep(39), RangeError);
});

test("timeline expands repeats with stable half-open boundaries", () => {
  const result = expandTimeline(audioProject(), 0, 17);
  assert.deepEqual(
    result.events.map(({ key, startStep }) => [key, startStep]),
    [
      ["00000000-0000-4000-8000-000000000009:0:00000000-0000-4000-8000-000000000005", 0],
      ["00000000-0000-4000-8000-000000000009:0:00000000-0000-4000-8000-000000000006", 4],
      ["00000000-0000-4000-8000-000000000009:1:00000000-0000-4000-8000-000000000005", 16],
    ],
  );
  assert.deepEqual(result.issues, []);
  assert.equal(arrangementEndStep(audioProject()), 48);
});

test("seek into a sustained synth note keeps only its remaining duration", () => {
  const result = expandTimeline(audioProject(), 40, 42);
  assert.deepEqual(result.events, [
    {
      key: "00000000-0000-4000-8000-000000000010:0:00000000-0000-4000-8000-000000000008",
      kind: "synth",
      trackId: "00000000-0000-4000-8000-000000000003",
      instrumentId: "synth.bass",
      startStep: 40,
      durationSteps: 4,
      midiNote: 48,
    },
  ]);
});

test("mixer-only changes preserve the playback fingerprint", () => {
  const before = audioProject();
  const changedTrack = { ...before.tracks[0]!, volumeDb: -12, muted: true };
  const after = { ...before, masterVolumeDb: -6, tracks: [changedTrack, before.tracks[1]!] };
  assert.equal(playbackFingerprint(before), playbackFingerprint(after));
  assert.notEqual(playbackFingerprint(before), playbackFingerprint({ ...before, bpm: 121 }));
});

test("shared synth patterns route separate events through each clip's track", () => {
  const original = audioProject();
  const project: Project = {
    ...original,
    tracks: [...original.tracks, {
      id: "lead", name: "Lead", kind: "synth", instrumentId: "synth.lead",
      volumeDb: 0, pan: 0, muted: false, soloed: false,
    }],
    arrangement: [original.arrangement[1]!, {
      id: "lead-clip", patternId: "00000000-0000-4000-8000-000000000007",
      trackId: "lead", startBar: 2, repeatCount: 1,
    }],
  };
  const result = expandTimeline(project, 32, 48);

  assert.deepEqual(result.events, [
    {
      key: "00000000-0000-4000-8000-000000000010:0:00000000-0000-4000-8000-000000000008",
      kind: "synth", trackId: "00000000-0000-4000-8000-000000000003",
      instrumentId: "synth.bass", startStep: 36, durationSteps: 8, midiNote: 48,
    },
    {
      key: "lead-clip:0:00000000-0000-4000-8000-000000000008",
      kind: "synth", trackId: "lead", instrumentId: "synth.lead",
      startStep: 36, durationSteps: 8, midiNote: 48,
    },
  ]);
  assert.deepEqual(result.issues, []);
  assert.notEqual(playbackFingerprint(project), playbackFingerprint({
    ...project,
    arrangement: project.arrangement.map((clip) => ({ ...clip, trackId: "lead" })),
  }));
});

test("a missing clip track is diagnosed while valid sibling clips still expand", () => {
  const project = audioProject();
  const result = expandTimeline({
    ...project,
    arrangement: project.arrangement.map((clip, index) => index === 0
      ? { ...clip, trackId: "missing-drums" }
      : clip),
  }, 0, 48);

  assert.deepEqual(result.issues, [{
    code: "missing_track", message: "Arrangement clip references a missing track",
    relatedId: "missing-drums",
  }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.trackId, "00000000-0000-4000-8000-000000000003");
});

test("stale references are skipped with entity-specific diagnostics", () => {
  const value = audioProject();
  const result = expandTimeline(
    { ...value, patterns: value.patterns.slice(1) },
    0,
    16,
  );
  assert.deepEqual(result.events, []);
  assert.equal(result.issues[0]?.code, "missing_pattern");
  assert.equal(result.issues[0]?.relatedId, value.arrangement[0]?.patternId);
});

test("timeline silently skips events outside their local pattern bounds", () => {
  const project = audioProject();
  const result = expandTimeline({
    ...project,
    patterns: project.patterns.map((pattern) => pattern.kind === "drum"
      ? {
        ...pattern,
        events: [
          ...pattern.events,
          { id: "outside-drum", soundId: "kick", startStep: 16 },
        ],
      }
      : {
        ...pattern,
        events: [
          ...pattern.events,
          { id: "outside-synth", midiNote: 60, startStep: 15, lengthSteps: 2 },
        ],
      }),
  }, 0, 64);
  assert.deepEqual(
    result.events.filter(({ key }) => key.endsWith(":outside-drum") || key.endsWith(":outside-synth")),
    [],
  );
  assert.deepEqual(result.issues, []);
});
