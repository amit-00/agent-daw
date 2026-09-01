export type EntityId = string;
export type TrackKind = "drum" | "synth";
export type PatternLengthBars = 1 | 2 | 4;

export interface DrumHit {
  readonly id: EntityId;
  readonly soundId: string;
  readonly startStep: number;
}

export interface SynthNote {
  readonly id: EntityId;
  readonly midiNote: number;
  readonly startStep: number;
  readonly lengthSteps: number;
}

export interface DrumPattern {
  readonly id: EntityId;
  readonly trackId: EntityId;
  readonly name: string;
  readonly kind: "drum";
  readonly lengthBars: PatternLengthBars;
  readonly events: readonly DrumHit[];
}

export interface SynthPattern {
  readonly id: EntityId;
  readonly trackId: EntityId;
  readonly name: string;
  readonly kind: "synth";
  readonly lengthBars: PatternLengthBars;
  readonly events: readonly SynthNote[];
}

export type Pattern = DrumPattern | SynthPattern;

export interface Track {
  readonly id: EntityId;
  readonly name: string;
  readonly kind: TrackKind;
  readonly instrumentId: string;
  readonly volumeDb: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly soloed: boolean;
}

export interface ArrangementClip {
  readonly id: EntityId;
  readonly patternId: EntityId;
  readonly startBar: number;
  readonly repeatCount: number;
}

export interface Project {
  readonly schemaVersion: 1;
  readonly id: EntityId;
  readonly name: string;
  readonly bpm: number;
  readonly masterVolumeDb: number;
  readonly tracks: readonly Track[];
  readonly patterns: readonly Pattern[];
  readonly arrangement: readonly ArrangementClip[];
}

export interface SoundCatalog {
  readonly drumKits: readonly {
    readonly id: string;
    readonly soundIds: readonly string[];
  }[];
  readonly synthPresets: readonly { readonly id: string }[];
}

export const PROJECT_CAPS = {
  maxTracks: 16,
  maxPatterns: 128,
  maxEventsPerPattern: 512,
  maxArrangementClips: 512,
  maxArrangementBars: 256,
  maxOperationsPerBatch: 100,
  maxHistoryEntries: 100,
  maxSuccessfulCommands: 100,
} as const;
