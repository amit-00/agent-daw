export type TrackId = "drums" | "bass" | "chords" | "melody" | "pad";
export type EditorTab = "mixer" | "pattern";

export interface Track {
  readonly id: TrackId;
  readonly name: string;
  readonly kind: "drum" | "synth";
  readonly color: string;
  readonly preset: string;
  readonly volume: number;
}

export interface Clip {
  readonly id: string;
  readonly trackId: TrackId;
  readonly name: string;
  readonly start: number;
  readonly width: number;
  readonly detail: string;
}

export interface Pattern {
  readonly id: string;
  readonly clipId: string;
  readonly steps: readonly number[];
}

export interface ActivityEntry {
  readonly title: string;
  readonly detail: string;
}
