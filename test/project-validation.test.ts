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
  drumKits: [
    { id: "kit.basic", soundIds: ["kick", "snare", "hat"] },
    { id: "kit.no-kick", soundIds: ["snare"] },
  ],
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
  { name: "track.update rejects a catalog kit missing placed sounds", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "track.update", trackId: "drums", changes: { instrumentId: "kit.no-kick" } }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
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

const ruleMatrixCases: readonly {
  readonly name: string;
  readonly input?: Project;
  readonly operation: Operation;
  readonly code: ProjectValidationError["code"];
  readonly field: string;
}[] = [
  { name: "project.update rejects undefined-only changes", operation: { type: "project.update", changes: { name: undefined } as never }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "project.update rejects non-finite bpm", operation: { type: "project.update", changes: { bpm: Number.POSITIVE_INFINITY } }, code: "OUT_OF_RANGE", field: "bpm" },
  { name: "track.create rejects the track cap", input: project({ tracks: Array.from({ length: 16 }, (_, index) => drumTrack({ id: `track-${index}` })) }), operation: { type: "track.create", track: drumTrack() }, code: "CAPACITY_EXCEEDED", field: "tracks" },
  { name: "track.create rejects an invalid name", operation: { type: "track.create", track: drumTrack({ name: " " }) }, code: "OUT_OF_RANGE", field: "name" },
  { name: "track.create rejects invalid pan", operation: { type: "track.create", track: drumTrack({ pan: -2 }) }, code: "OUT_OF_RANGE", field: "pan" },
  { name: "track.update rejects undefined-only changes", input: project({ tracks: [drumTrack()] }), operation: { type: "track.update", trackId: "drums", changes: { name: undefined } as never }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "track.update validates the full mixer candidate", input: project({ tracks: [drumTrack()] }), operation: { type: "track.update", trackId: "drums", changes: { volumeDb: -61 } }, code: "OUT_OF_RANGE", field: "volume_db" },
  { name: "track.reorder rejects a missing track", operation: { type: "track.reorder", trackId: "missing", toIndex: 0 }, code: "TRACK_NOT_FOUND", field: "track_id" },
  { name: "track.reorder rejects an index beyond the final track", input: project({ tracks: [drumTrack()] }), operation: { type: "track.reorder", trackId: "drums", toIndex: 1 }, code: "OUT_OF_RANGE", field: "to_index" },
  { name: "pattern.create rejects a duplicate id", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.create", pattern: drumPattern() }, code: "OUT_OF_RANGE", field: "pattern.id" },
  { name: "pattern.create rejects the pattern cap", input: project({ patterns: Array.from({ length: 128 }, (_, index) => drumPattern({ id: `pattern-${index}`, events: [] })) }), operation: { type: "pattern.create", pattern: drumPattern() }, code: "CAPACITY_EXCEEDED", field: "patterns" },
  { name: "pattern.create rejects invalid name", operation: { type: "pattern.create", pattern: drumPattern({ name: "" }) }, code: "OUT_OF_RANGE", field: "name" },
  { name: "pattern.create rejects an invalid length", operation: { type: "pattern.create", pattern: drumPattern({ lengthBars: 3 as never }) }, code: "OUT_OF_RANGE", field: "length_bars" },
  { name: "pattern.create rejects too many events", operation: { type: "pattern.create", pattern: drumPattern({ events: Array.from({ length: 513 }, (_, index) => ({ id: `hit-${index}`, soundId: "kick", startStep: 0 })) }) }, code: "CAPACITY_EXCEEDED", field: "events" },
  { name: "pattern.create rejects a missing catalog sound", operation: { type: "pattern.create", pattern: drumPattern({ events: [{ id: "hit", soundId: "missing", startStep: 0 }] }) }, code: "INCOMPATIBLE_INSTRUMENT", field: "events[0].sound_id" },
  { name: "pattern.create rejects a fractional drum step", operation: { type: "pattern.create", pattern: drumPattern({ events: [{ id: "hit", soundId: "kick", startStep: 0.5 }] }) }, code: "OUT_OF_RANGE", field: "events[0].step" },
  { name: "pattern.duplicate rejects a missing source", operation: { type: "pattern.duplicate", patternId: "missing", duplicatePatternId: "copy", duplicateName: "Copy", duplicateEventIds: [] }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "pattern.duplicate rejects a duplicate destination", input: project({ patterns: [drumPattern(), drumPattern({ id: "copy", events: [] })] }), operation: { type: "pattern.duplicate", patternId: "beat", duplicatePatternId: "copy", duplicateName: "Copy", duplicateEventIds: ["new-hit"] }, code: "OUT_OF_RANGE", field: "duplicate_pattern_id" },
  { name: "pattern.duplicate rejects the pattern cap", input: project({ patterns: Array.from({ length: 128 }, (_, index) => drumPattern({ id: index === 0 ? "beat" : `pattern-${index}`, events: [] })) }), operation: { type: "pattern.duplicate", patternId: "beat", duplicatePatternId: "copy", duplicateName: "Copy", duplicateEventIds: [] }, code: "CAPACITY_EXCEEDED", field: "patterns" },
  { name: "pattern.duplicate rejects an invalid name", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.duplicate", patternId: "beat", duplicatePatternId: "copy", duplicateName: "", duplicateEventIds: ["new-hit"] }, code: "OUT_OF_RANGE", field: "duplicate_name" },
  { name: "pattern.duplicate rejects duplicate generated ids", input: project({ patterns: [drumPattern({ events: [{ id: "first", soundId: "kick", startStep: 0 }, { id: "second", soundId: "snare", startStep: 1 }] })] }), operation: { type: "pattern.duplicate", patternId: "beat", duplicatePatternId: "copy", duplicateName: "Copy", duplicateEventIds: ["new", "new"] }, code: "OUT_OF_RANGE", field: "duplicate_event_ids" },
  { name: "pattern.update rejects undefined-only changes", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.update", patternId: "beat", changes: { name: undefined } as never }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "pattern.update rejects a missing pattern", operation: { type: "pattern.update", patternId: "missing", changes: { name: "New" } }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "pattern.update rejects an invalid name", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.update", patternId: "beat", changes: { name: "" } }, code: "OUT_OF_RANGE", field: "name" },
  { name: "arrangement.place rejects a duplicate clip id", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 2, repeatCount: 1 } }, code: "OUT_OF_RANGE", field: "clip.id" },
  { name: "arrangement.place rejects the clip cap", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: Array.from({ length: 512 }, (_, index) => ({ id: `clip-${index}`, patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 })) }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 } }, code: "CAPACITY_EXCEEDED", field: "arrangement" },
  { name: "arrangement.place rejects a missing pattern", input: project({ tracks: [drumTrack()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "missing", trackId: "drums", startBar: 0, repeatCount: 1 } }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "arrangement.place rejects a missing track", input: project({ patterns: [drumPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "missing", startBar: 0, repeatCount: 1 } }, code: "TRACK_NOT_FOUND", field: "track_id" },
  { name: "arrangement.place rejects a drum kit missing pattern sounds", input: project({ tracks: [drumTrack({ instrumentId: "kit.no-kick" })], patterns: [drumPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 } }, code: "INCOMPATIBLE_INSTRUMENT", field: "track_id" },
  { name: "arrangement.place rejects a negative start bar", input: project({ tracks: [drumTrack()], patterns: [drumPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: -1, repeatCount: 1 } }, code: "OUT_OF_RANGE", field: "start_bar" },
  { name: "arrangement.place rejects an invalid repeat count", input: project({ tracks: [drumTrack()], patterns: [drumPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 65 } }, code: "OUT_OF_RANGE", field: "repeat_count" },
  { name: "arrangement.place rejects clips ending after 256 bars", input: project({ tracks: [drumTrack()], patterns: [drumPattern({ lengthBars: 4 })] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 255, repeatCount: 1 } }, code: "OUT_OF_RANGE", field: "repeat_count" },
  { name: "arrangement.update rejects undefined-only changes", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "arrangement.update", clipId: "clip", changes: { startBar: undefined } as never }, code: "OUT_OF_RANGE", field: "changes" },
  { name: "arrangement.update validates a candidate overlap", input: project({ tracks: [drumTrack()], patterns: [drumPattern()], arrangement: [{ id: "first", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }, { id: "second", patternId: "beat", trackId: "drums", startBar: 1, repeatCount: 1 }] }), operation: { type: "arrangement.update", clipId: "second", changes: { startBar: 0 } }, code: "CLIP_OVERLAP", field: "start_bar" },
  { name: "drum-hits.add rejects an empty list", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [] }, code: "OUT_OF_RANGE", field: "hits" },
  { name: "drum-hits.add rejects duplicate new ids", input: project({ patterns: [drumPattern({ events: [] })] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [{ id: "hit", soundId: "kick", startStep: 0 }, { id: "hit", soundId: "snare", startStep: 1 }] }, code: "OUT_OF_RANGE", field: "hits[1].id" },
  { name: "drum-hits.add rejects a non-catalog sound", input: project({ patterns: [drumPattern({ events: [] })] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [{ id: "hit", soundId: "missing", startStep: 0 }] }, code: "INCOMPATIBLE_INSTRUMENT", field: "hits[0].sound_id" },
  { name: "drum-hits.add rejects an out-of-pattern step", input: project({ patterns: [drumPattern({ events: [] })] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [{ id: "hit", soundId: "kick", startStep: 16 }] }, code: "OUT_OF_RANGE", field: "hits[0].step" },
  { name: "drum-hits.add rejects a full pattern", input: project({ patterns: [drumPattern({ events: Array.from({ length: 512 }, (_, index) => ({ id: `hit-${index}`, soundId: "kick", startStep: 0 })) })] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [{ id: "next", soundId: "kick", startStep: 0 }] }, code: "CAPACITY_EXCEEDED", field: "hits" },
  { name: "drum-hits.add rejects a resulting kit incompatibility", input: project({ tracks: [drumTrack({ instrumentId: "kit.no-kick" })], patterns: [drumPattern({ events: [{ id: "snare", soundId: "snare", startStep: 0 }] })], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "drum-hits.add", patternId: "beat", hits: [{ id: "kick", soundId: "kick", startStep: 1 }] }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "drum-hits.update rejects undefined-only changes", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [{ hitId: "kick", changes: { soundId: undefined } as never }] }, code: "OUT_OF_RANGE", field: "updates[0].changes" },
  { name: "drum-hits.update rejects an empty list", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [] }, code: "OUT_OF_RANGE", field: "updates" },
  { name: "drum-hits.update validates resulting hit values", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [{ hitId: "kick", changes: { startStep: 16 } }] }, code: "OUT_OF_RANGE", field: "events[0].step" },
  { name: "drum-hits.delete rejects an empty list", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.delete", patternId: "beat", hitIds: [] }, code: "OUT_OF_RANGE", field: "hit_ids" },
  { name: "synth-notes.add rejects an empty list", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.add", patternId: "line", notes: [] }, code: "OUT_OF_RANGE", field: "notes" },
  { name: "synth-notes.add rejects duplicate new ids", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "note", midiNote: 60, startStep: 0, lengthSteps: 1 }, { id: "note", midiNote: 61, startStep: 1, lengthSteps: 1 }] }, code: "OUT_OF_RANGE", field: "notes[1].id" },
  { name: "synth-notes.add rejects invalid midi", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "note", midiNote: 23, startStep: 0, lengthSteps: 1 }] }, code: "OUT_OF_RANGE", field: "notes[0].midi_note" },
  { name: "synth-notes.add rejects a negative step", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "note", midiNote: 60, startStep: -1, lengthSteps: 1 }] }, code: "OUT_OF_RANGE", field: "notes[0].step" },
  { name: "synth-notes.add rejects non-positive length", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "note", midiNote: 60, startStep: 0, lengthSteps: 0 }] }, code: "OUT_OF_RANGE", field: "notes[0].length_steps" },
  { name: "synth-notes.add rejects a full pattern", input: project({ patterns: [synthPattern({ events: Array.from({ length: 512 }, (_, index) => ({ id: `note-${index}`, midiNote: 60, startStep: 0, lengthSteps: 1 })) })] }), operation: { type: "synth-notes.add", patternId: "line", notes: [{ id: "next", midiNote: 60, startStep: 0, lengthSteps: 1 }] }, code: "CAPACITY_EXCEEDED", field: "notes" },
  { name: "synth-notes.update rejects undefined-only changes", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: [{ noteId: "note", changes: { midiNote: undefined } as never }] }, code: "OUT_OF_RANGE", field: "updates[0].changes" },
  { name: "synth-notes.update rejects an empty list", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: [] }, code: "OUT_OF_RANGE", field: "updates" },
  { name: "synth-notes.update validates resulting note values", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: [{ noteId: "note", changes: { midiNote: 97 } }] }, code: "OUT_OF_RANGE", field: "events[0].midi_note" },
  { name: "synth-notes.delete rejects an empty list", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.delete", patternId: "line", noteIds: [] }, code: "OUT_OF_RANGE", field: "note_ids" },
];

for (const invalid of ruleMatrixCases) {
  test(invalid.name, () => expectError(invalid.operation, invalid.code, invalid.field, invalid.input));
}

const remainingMatrixCases: readonly {
  readonly name: string;
  readonly input?: Project;
  readonly operation: Operation;
  readonly code: ProjectValidationError["code"];
  readonly field: string;
}[] = [
  { name: "track.update rejects an invalid name", input: project({ tracks: [drumTrack()] }), operation: { type: "track.update", trackId: "drums", changes: { name: "" } }, code: "OUT_OF_RANGE", field: "name" },
  { name: "track.update rejects an incompatible instrument", input: project({ tracks: [drumTrack()] }), operation: { type: "track.update", trackId: "drums", changes: { instrumentId: "missing" } }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "track.create rejects a missing synth preset", operation: { type: "track.create", track: { ...drumTrack(), kind: "synth", instrumentId: "missing" } }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "track.create rejects non-finite volume", operation: { type: "track.create", track: drumTrack({ volumeDb: Number.POSITIVE_INFINITY }) }, code: "OUT_OF_RANGE", field: "volume_db" },
  { name: "pattern.update rejects an invalid length", input: project({ patterns: [drumPattern()] }), operation: { type: "pattern.update", patternId: "beat", changes: { lengthBars: 3 as never } }, code: "OUT_OF_RANGE", field: "length_bars" },
  { name: "arrangement.place rejects a fractional start bar", input: project({ tracks: [drumTrack()], patterns: [drumPattern()] }), operation: { type: "arrangement.place", clip: { id: "clip", patternId: "beat", trackId: "drums", startBar: 0.5, repeatCount: 1 } }, code: "OUT_OF_RANGE", field: "start_bar" },
  { name: "drum-hits.add rejects more than 512 hits", input: project({ patterns: [drumPattern({ events: [] })] }), operation: { type: "drum-hits.add", patternId: "beat", hits: Array.from({ length: 513 }, (_, index) => ({ id: `hit-${index}`, soundId: "kick", startStep: 0 })) }, code: "OUT_OF_RANGE", field: "hits" },
  { name: "drum-hits.update rejects a missing hit", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [{ hitId: "missing", changes: { startStep: 1 } }] }, code: "HIT_NOT_FOUND", field: "updates[0].hit_id" },
  { name: "drum-hits.update rejects more than 512 updates", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.update", patternId: "beat", updates: Array.from({ length: 513 }, () => ({ hitId: "kick", changes: { startStep: 1 } })) }, code: "OUT_OF_RANGE", field: "updates" },
  { name: "drum-hits.update rejects a resulting placed-kit incompatibility", input: project({ tracks: [drumTrack({ instrumentId: "kit.no-kick" })], patterns: [drumPattern({ events: [{ id: "snare", soundId: "snare", startStep: 0 }] })], arrangement: [{ id: "clip", patternId: "beat", trackId: "drums", startBar: 0, repeatCount: 1 }] }), operation: { type: "drum-hits.update", patternId: "beat", updates: [{ hitId: "snare", changes: { soundId: "kick" } }] }, code: "INCOMPATIBLE_INSTRUMENT", field: "instrument_id" },
  { name: "drum-hits.delete rejects a duplicate hit id", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.delete", patternId: "beat", hitIds: ["kick", "kick"] }, code: "OUT_OF_RANGE", field: "hit_ids[1]" },
  { name: "drum-hits.delete rejects more than 512 ids", input: project({ patterns: [drumPattern()] }), operation: { type: "drum-hits.delete", patternId: "beat", hitIds: Array.from({ length: 513 }, () => "kick") }, code: "OUT_OF_RANGE", field: "hit_ids" },
  { name: "drum-hits.delete rejects a synth pattern", input: project({ patterns: [synthPattern()] }), operation: { type: "drum-hits.delete", patternId: "line", hitIds: ["note"] }, code: "KIND_MISMATCH", field: "pattern_id" },
  { name: "synth-notes.add rejects a missing synth pattern", operation: { type: "synth-notes.add", patternId: "missing", notes: [{ id: "note", midiNote: 60, startStep: 0, lengthSteps: 1 }] }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "synth-notes.add rejects more than 512 notes", input: project({ patterns: [synthPattern({ events: [] })] }), operation: { type: "synth-notes.add", patternId: "line", notes: Array.from({ length: 513 }, (_, index) => ({ id: `note-${index}`, midiNote: 60, startStep: 0, lengthSteps: 1 })) }, code: "OUT_OF_RANGE", field: "notes" },
  { name: "synth-notes.update rejects a missing synth pattern", operation: { type: "synth-notes.update", patternId: "missing", updates: [{ noteId: "note", changes: { midiNote: 60 } }] }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "synth-notes.update rejects more than 512 updates", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: Array.from({ length: 513 }, () => ({ noteId: "note", changes: { midiNote: 60 } })) }, code: "OUT_OF_RANGE", field: "updates" },
  { name: "synth-notes.update rejects duplicate ids", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.update", patternId: "line", updates: [{ noteId: "note", changes: { midiNote: 61 } }, { noteId: "note", changes: { midiNote: 62 } }] }, code: "OUT_OF_RANGE", field: "updates[1].note_id" },
  { name: "synth-notes.delete rejects a missing synth pattern", operation: { type: "synth-notes.delete", patternId: "missing", noteIds: ["note"] }, code: "PATTERN_NOT_FOUND", field: "pattern_id" },
  { name: "synth-notes.delete rejects a duplicate note id", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.delete", patternId: "line", noteIds: ["note", "note"] }, code: "OUT_OF_RANGE", field: "note_ids[1]" },
  { name: "synth-notes.delete rejects more than 512 ids", input: project({ patterns: [synthPattern()] }), operation: { type: "synth-notes.delete", patternId: "line", noteIds: Array.from({ length: 513 }, () => "note") }, code: "OUT_OF_RANGE", field: "note_ids" },
];

for (const invalid of remainingMatrixCases) {
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
