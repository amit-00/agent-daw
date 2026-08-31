import type { ActivityEntry, Clip, Pattern, Track, TrackId } from "@/types/studio";

export const TRACKS: readonly Track[] = [
  { id: "drums", name: "Neon Kit", kind: "drum", color: "#9a69f5", preset: "Polaroid Drums", volume: 74 },
  { id: "bass", name: "Low Orbit", kind: "synth", color: "#d95fc8", preset: "Velvet Sub", volume: 68 },
  { id: "chords", name: "Glasshouse", kind: "synth", color: "#ef6070", preset: "Warm Glass", volume: 61 },
  { id: "melody", name: "Afterglow", kind: "synth", color: "#f18a4c", preset: "Soft Signal", volume: 72 },
  { id: "pad", name: "Night Air", kind: "synth", color: "#efbd52", preset: "Cloud Pad", volume: 55 },
];

export const CLIPS: readonly Clip[] = [
  { id: "drums-a", trackId: "drums", name: "Neon Kit · Main", start: 0, width: 50, detail: "4 bars · 64 steps" },
  { id: "drums-b", trackId: "drums", name: "Neon Kit · Lift", start: 50, width: 26, detail: "2 bars · 32 steps" },
  { id: "bass-a", trackId: "bass", name: "Low Orbit · A", start: 0, width: 50, detail: "4 bars · 14 notes" },
  { id: "bass-b", trackId: "bass", name: "Low Orbit · B", start: 52, width: 48, detail: "4 bars · 12 notes" },
  { id: "chords-a", trackId: "chords", name: "Glasshouse", start: 0, width: 50, detail: "4 bars · 22 notes" },
  { id: "chords-b", trackId: "chords", name: "Glasshouse · Open", start: 50, width: 50, detail: "4 bars · 18 notes" },
  { id: "melody-a", trackId: "melody", name: "Afterglow", start: 18, width: 58, detail: "4 bars · 19 notes" },
  { id: "pad-a", trackId: "pad", name: "Night Air", start: 0, width: 100, detail: "8 bars · 16 notes" },
];

export const PROJECT_PATTERNS: readonly Pattern[] = [
  { id: "neon-main", clipId: "drums-a", steps: [1, 6, 12, 17, 23, 29, 36, 42, 49, 55, 60] },
  { id: "neon-lift", clipId: "drums-b", steps: [0, 4, 8, 13, 16, 20, 24, 29, 33, 37, 40, 45, 49, 53, 56, 61] },
  { id: "orbit-a", clipId: "bass-a", steps: [2, 10, 18, 26, 35, 42, 50, 58] },
  { id: "orbit-b", clipId: "bass-b", steps: [5, 12, 19, 28, 36, 43, 52, 59] },
  { id: "glasshouse", clipId: "chords-a", steps: [1, 6, 12, 17, 23, 29, 36, 42, 49, 55, 60] },
  { id: "glasshouse-open", clipId: "chords-b", steps: [3, 10, 18, 25, 34, 41, 50, 57] },
  { id: "afterglow", clipId: "melody-a", steps: [2, 9, 14, 22, 30, 39, 45, 54, 61] },
  { id: "night-air", clipId: "pad-a", steps: [0, 8, 16, 24, 32, 40, 48, 56] },
];

export const DRUM_LEVELS = [33, 58, 41, 75, 51, 86, 42, 67, 47, 80, 57, 91, 49, 70, 38, 76, 53, 88, 44, 72, 35, 61, 46, 82] as const;

export const NOTE_MARKS = [
  [5, 22, 16], [18, 46, 25], [32, 31, 11], [43, 62, 20],
  [58, 18, 13], [67, 43, 21], [82, 29, 12], [91, 56, 7],
] as const;

export const SEQUENCE_NOTES = ["C5", "A4", "F4", "C4"] as const;

export const ACTIVITY_ENTRIES: readonly ActivityEntry[] = [
  { title: "Agent shaped Glasshouse", detail: "Added open voicings · just now" },
  { title: "You adjusted Neon Kit", detail: "Muted the final kick · 2m" },
  { title: "Agent created Afterglow", detail: "19 notes · 6m" },
  { title: "You renamed the project", detail: "Midnight Polaroid · 9m" },
];

function requireItem<T extends { readonly id: string }>(items: readonly T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown ${label} "${id}". Check studio-data.ts fixture relationships.`);
  }
  return item;
}

export const getTrack = (id: TrackId): Track => requireItem(TRACKS, id, "track");
export const getClip = (id: string): Clip => requireItem(CLIPS, id, "clip");
export const getPattern = (id: string): Pattern => requireItem(PROJECT_PATTERNS, id, "pattern");
export const findPatternForClip = (clipId: string): Pattern | undefined =>
  PROJECT_PATTERNS.find((pattern) => pattern.clipId === clipId);
