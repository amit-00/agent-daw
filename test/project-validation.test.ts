import assert from "node:assert/strict";
import test from "node:test";

import {
  type Operation,
  type DrumPattern,
  type Project,
  type SoundCatalog,
  type SynthPattern,
  type Track,
  ProjectValidationError,
  validateOperation,
  validateOperations,
} from "../src/project/index.ts";

const catalog: SoundCatalog = {
  drumKits: [{ id: "kit.basic", soundIds: ["kick", "snare", "hat"] }],
  synthPresets: [{ id: "synth.bass" }],
};

const project = (changes: Partial<Project> = {}): Project => ({
  schemaVersion: 2,
  id: "project",
  name: "Untitled",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [],
  patterns: [],
  arrangement: [],
  ...changes,
});

const drumTrack = (changes: Partial<Track> = {}): Track => ({
  id: "drums",
  name: "Drums",
  kind: "drum",
  instrumentId: "kit.basic",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
  ...changes,
});

const drumPattern = (changes: Partial<DrumPattern> = {}): DrumPattern => ({
  id: "beat", name: "Beat", kind: "drum" as const, lengthBars: 1 as const,
  events: [{ id: "kick", soundId: "kick", startStep: 0 }], ...changes,
});

const synthPattern = (changes: Partial<SynthPattern> = {}): SynthPattern => ({
  id: "line", name: "Line", kind: "synth" as const, lengthBars: 1 as const,
  events: [{ id: "note", midiNote: 60, startStep: 0, lengthSteps: 1 }], ...changes,
});

const expectError = (
  operation: Operation,
  code: ProjectValidationError["code"],
  field: string,
  input: Project = project(),
): void => {
  assert.throws(
    () => validateOperation(input, operation, catalog),
    (error: unknown) => error instanceof ProjectValidationError && error.code === code && error.field === field,
  );
};

const invalidCases: readonly {
  readonly name: string;
  readonly input?: Project;
  readonly operation: Operation;
  readonly code: ProjectValidationError["code"];
  readonly field: string;
}[] = [
  { name: "project.update rejects empty changes", operation: { type: "project.update", changes: {} }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "project.update rejects invalid name", operation: { type: "project.update", changes: { name: "  " } }, code: "OUT_OF_RANGE", field: "name" },
  { name: "project.update rejects out of range bpm", operation: { type: "project.update", changes: { bpm: 241 } }, code: "OUT_OF_RANGE", field: "bpm" },
  { name: "project.update rejects invalid master volume", operation: { type: "project.update", changes: { masterVolumeDb: Number.NaN } }, code: "OUT_OF_RANGE", field: "master_volume_db" },
  { name: "track.create rejects duplicate id", input: project({ tracks: [drumTrack()] }), operation: { type: "track.create", track: drumTrack() }, code: "OUT_OF_RANGE", field: "track.id" },
  { name: "track.create rejects incompatible instrument", operation: { type: "track.create", track: drumTrack({ instrumentId: "synth.bass" }) }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "track.create rejects invalid mixer values", operation: { type: "track.create", track: drumTrack({ volumeDb: 7 }) }, code: "OUT_OF_RANGE", field: "volume_db" },
  { name: "track.update rejects missing track", operation: { type: "track.update", trackId: "missing", changes: { name: "Nope" } }, code: "TRACK_NOT_FOUND", field: "track_id" },
  { name: "track.update rejects empty changes", input: project({ tracks: [drumTrack()] }), operation: { type: "track.update", trackId: "drums", changes: {} }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "track.update rejects a kit missing placed sounds", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "track.update", trackId: "drums", changes: { instrumentId: "kit.empty" } }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "track.reorder rejects non-integer index", input: project({ tracks: [drumTrack()] }), operation: { type: "track.reorder", trackId: "drums", toIndex: 0.5 }, code: "OUT_OF_RANGE", field: "to_index" },
  { name: "track.delete rejects missing track", operation: { type: "track.delete", trackId: "missing" }, code: "TRACK_NOT_FOUND", field: "track_id" },
  { name: "pattern.create rejects duplicate event ids", operation: { type: "pattern.create", pattern: drumPattern({ events: [{ id: "same", soundId: "kick", startStep: 0 }, { id: "same", soundId: "snare", startStep: 1 }] }) }, code: "OUT_OF_RANGE", field: "events[1].id" },
  { name: "pattern.create rejects invalid events", operation: { type: "pattern.create", pattern: synthPattern({ events: [{ id: "note", midiNote: 97, startStep: 0, lengthSteps: 1 }] }) }, code: "OUT_OF_RANGE", field: "events[0].midi_note" },
  { name: "pattern.duplicate rejects mismatched event ids", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.duplicate", patternId: "beat", duplicatePatternId: "copy", duplicateName: "Copy", duplicateEventIds: [] }, code: "OUT_OF_RANGE", field: "duplicate_event_ids" },
  { name: "pattern.update rejects shortening under events", input: project({ patterns: [synthPattern({ lengthBars: 2, events: [{ id: "note", midiNote: 60, startStep: 16, lengthSteps: 1 }] })] }), operation: { type: "pattern.update", patternId: "line", changes: { lengthBars: 1 } }, code: "OUT_OF_RANGE", field: "length_bars" },
  { name: "pattern.delete rejects missing pattern", operation: { type: "pattern.delete", patternId: "missing" }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "arrangement.place rejects kind mismatch", input: project({ tracks: [drumTrack()], patterns: [synthPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "line", trackId: "drums", startBar: 0, repeatCount: 1 } }, code: "KIND_MISMATCH", field: "track_id" },
  { name: "arrangement.place rejects overlap", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "first", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "arrangement.place", clip: { id: "second", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 } }, code: "CLIP_OVERLAP", field: "start_bar" },
  { name: "arrangement.update rejects missing clip", operation: { type: "arrangement.update", clipId: "missing", changes: { startBar: 0 } }, code: "CLIP_NOT_FOUND", field: "clip_id" },
  { name: "arrangement.delete rejects missing clip", operation: { type: "arrangement.delete", clipId: "missing" }, code: "CLIP_NOT_FOUND", field: "clip_id" },
  { name: "drum-hits.add rejects missing drum pattern", operation: { type: "drum-hits.add", patternId: "missing", hits: [{ id: "hit", soundId: "kick", startStep: 0 }] }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "drum-hits.update rejects duplicate hit ids", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [{ hitId: "kick", changes: { startStep: 1 } }, { hitId: "kick", changes: { startStep: 2 } }] }, code: "OUT_OF_RANGE", field: "updates[1].hit_id" },
  { name: "drum-hits.delete rejects missing hit", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.delete", patternId: "beat", hitIds: ["missing"] }, code: "HIT_NOT_FOUND", field: "hit_ids[0]" },
  { name: "synth-notes.add rejects notes past pattern end", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "note", midiNote: 60, startStep: 15, lengthSteps: 2 }] }, code: "OUT_OF_RANGE", field: "notes[0].length_steps" },
  { name: "synth-notes.update rejects missing note", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: [{ noteId: "missing", changes: { midiNote: 60 } }] }, code: "NOTE_NOT_FOUND", field: "updates[0].note_id" },
  { name: "synth-notes.delete rejects duplicate note ids", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.delete", patternId: "line", noteIds: ["note", "note"] }, code: "OUT_OF_RANGE", field: "note_ids[1]" },
];

for (const invalid of invalidCases) {
  test(invalid.name, () => expectError(invalid.operation, invalid.code, invalid.field, invalid.input));
}

test("validateOperation is pure after success and failure", () => {
  const input = project({ tracks: [drumTrack()] });
  const successful: Operation = { type: "track.update", trackId: "drums", changes: { name: "Kit" } };
  const failing: Operation = { type: "track.update", trackId: "drums", changes: { pan: 2 } };
  const successfulBefore = structuredClone(successful);
  const failingBefore = structuredClone(failing);
  const inputBefore = structuredClone(input);

  validateOperation(input, successful, catalog);
  assert.throws(() => validateOperation(input, failing, catalog), ProjectValidationError);

  assert.deepEqual(input, inputBefore);
  assert.deepEqual(successful, successfulBefore);
  assert.deepEqual(failing, failingBefore);
});

test("validateOperations validates each operation against the preceding result", () => {
  const operations: readonly Operation[] = [
    { type: "pattern.create", pattern: drumPattern({ events: [] }) },
    { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 } },
  ];
  const input = project({ tracks: [drumTrack()] });

  const result = validateOperations(input, operations, catalog);
  assert.equal(result.project.arrangement.length, 1);
  expectError(operations[1]!, "PATTERN_NOT_FOUND", "pattern_id", input);
});
