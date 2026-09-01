import type { Project, Track } from "@/project";

export const EMPTY_PROJECT: Project = {
  schemaVersion: 2, id: "session", name: "Untitled", bpm: 120, masterVolumeDb: 0,
  tracks: [], patterns: [], arrangement: [],
};

export const INSTRUMENT_NAMES: Readonly<Record<string, string>> = {
  "kit.basic": "Basic drums", "synth.bass": "Bass", "synth.chord": "Chords",
  "synth.lead": "Lead", "synth.pad": "Pad",
};

const TRACK_COLORS: ReadonlyMap<string, string> = new Map([
  ["drums", "#9a69f5"], ["bass", "#d95fc8"], ["chords", "#ef6070"],
  ["melody", "#f18a4c"], ["pad", "#efbd52"],
]);

export const TRACK_COLOR_WHEEL: readonly string[] = [
  ...TRACK_COLORS.values(), "#70bd72", "#50b8b1", "#598fe3",
];

export function getTrackColor(track: Pick<Track, "id" | "color">): string {
  if (track.color) return track.color;
  const index = Array.from(track.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return TRACK_COLORS.get(track.id) ?? [...TRACK_COLORS.values()][index % TRACK_COLORS.size]!;
}

export const DEMO_PROJECT: Project = {
  ...EMPTY_PROJECT,
  id: "demo", name: "Midnight Polaroid", bpm: 118, masterVolumeDb: -3,
  tracks: [
    { id: "drums", name: "Neon Kit", kind: "drum", instrumentId: "kit.basic",
      volumeDb: -6, pan: 0, muted: false, soloed: false },
    { id: "bass", name: "Low Orbit", kind: "synth", instrumentId: "synth.bass",
      volumeDb: -9, pan: 0, muted: false, soloed: false },
    { id: "chords", name: "Glasshouse", kind: "synth", instrumentId: "synth.chord",
      volumeDb: -12, pan: -0.15, muted: false, soloed: false },
    { id: "melody", name: "Afterglow", kind: "synth", instrumentId: "synth.lead",
      volumeDb: -8, pan: 0.2, muted: false, soloed: false },
    { id: "pad", name: "Night Air", kind: "synth", instrumentId: "synth.pad",
      volumeDb: -15, pan: 0, muted: false, soloed: false },
  ],
  patterns: [
    { id: "neon", name: "Neon beat", kind: "drum", lengthBars: 1, events: [
      ...[0, 4, 8, 12].map((startStep) => ({ id: "kick-" + startStep, soundId: "kick", startStep })),
      ...[4, 12].map((startStep) => ({ id: "snare-" + startStep, soundId: "snare", startStep })),
      ...[2, 6, 10, 14].map((startStep) => ({ id: "hat-" + startStep, soundId: "hat", startStep })),
    ] },
    { id: "orbit", name: "Low Orbit phrase", kind: "synth", lengthBars: 2, events: [
      { id: "bass-1", midiNote: 36, startStep: 0, lengthSteps: 6 },
      { id: "bass-2", midiNote: 43, startStep: 8, lengthSteps: 4 },
      { id: "bass-3", midiNote: 39, startStep: 16, lengthSteps: 6 },
      { id: "bass-4", midiNote: 46, startStep: 24, lengthSteps: 4 },
    ] },
    { id: "glasshouse", name: "Glasshouse", kind: "synth", lengthBars: 2, events: [
      ...[60, 64, 67].map((midiNote) => ({ id: "chord-a-" + midiNote, midiNote, startStep: 0, lengthSteps: 12 })),
      ...[60, 63, 67].map((midiNote) => ({ id: "chord-b-" + midiNote, midiNote, startStep: 16, lengthSteps: 12 })),
    ] },
    { id: "afterglow", name: "Afterglow", kind: "synth", lengthBars: 2, events: [
      { id: "lead-1", midiNote: 72, startStep: 0, lengthSteps: 3 },
      { id: "lead-2", midiNote: 76, startStep: 6, lengthSteps: 3 },
      { id: "lead-3", midiNote: 79, startStep: 12, lengthSteps: 4 },
      { id: "lead-4", midiNote: 75, startStep: 20, lengthSteps: 6 },
    ] },
    { id: "night-air", name: "Night Air", kind: "synth", lengthBars: 4, events: [
      { id: "pad-1", midiNote: 48, startStep: 0, lengthSteps: 64 },
      { id: "pad-2", midiNote: 55, startStep: 0, lengthSteps: 64 },
    ] },
    { id: "unused-idea", name: "Unused idea", kind: "synth", lengthBars: 1, events: [] },
  ],
  arrangement: [
    { id: "drums-a", trackId: "drums", patternId: "neon", startBar: 0, repeatCount: 4 },
    { id: "drums-b", trackId: "drums", patternId: "neon", startBar: 4, repeatCount: 4 },
    { id: "bass-a", trackId: "bass", patternId: "orbit", startBar: 0, repeatCount: 2 },
    { id: "bass-b", trackId: "bass", patternId: "orbit", startBar: 4, repeatCount: 2 },
    { id: "chords-a", trackId: "chords", patternId: "glasshouse", startBar: 0, repeatCount: 2 },
    { id: "chords-b", trackId: "chords", patternId: "glasshouse", startBar: 4, repeatCount: 2 },
    { id: "melody-a", trackId: "melody", patternId: "afterglow", startBar: 2, repeatCount: 2 },
    { id: "pad-a", trackId: "pad", patternId: "night-air", startBar: 0, repeatCount: 2 },
  ],
};
