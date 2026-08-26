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
