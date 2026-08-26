import type { SoundCatalog } from "../project/index.ts";

export type DrumSoundId = "kick" | "snare" | "hat";
export type SynthPresetId =
  | "synth.bass"
  | "synth.chord"
  | "synth.lead"
  | "synth.pad";

export interface DrumSoundDefinition {
  readonly id: DrumSoundId;
  readonly url: string;
}

export interface DrumKitDefinition {
  readonly id: "kit.basic";
  readonly sounds: readonly DrumSoundDefinition[];
}

export interface SynthPreset {
  readonly id: SynthPresetId;
  readonly oscillator: OscillatorType;
  readonly filterCutoffHz: number;
  readonly filterQ: number;
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly sustainGain: number;
  readonly releaseSeconds: number;
  readonly peakGain: number;
}

export const BASIC_DRUM_KIT: DrumKitDefinition = {
  id: "kit.basic",
  sounds: [
    { id: "kick", url: "/demo/drums/kick.wav" },
    { id: "snare", url: "/demo/drums/snare.wav" },
    { id: "hat", url: "/demo/drums/hat.wav" },
  ],
};

export const SYNTH_PRESETS: Readonly<Record<SynthPresetId, SynthPreset>> = {
  "synth.bass": {
    id: "synth.bass",
    oscillator: "sawtooth",
    filterCutoffHz: 600,
    filterQ: 1,
    attackSeconds: 0.005,
    decaySeconds: 0.12,
    sustainGain: 0.55,
    releaseSeconds: 0.12,
    peakGain: 0.14,
  },
  "synth.chord": {
    id: "synth.chord",
    oscillator: "triangle",
    filterCutoffHz: 1_800,
    filterQ: 1,
    attackSeconds: 0.02,
    decaySeconds: 0.2,
    sustainGain: 0.65,
    releaseSeconds: 0.35,
    peakGain: 0.11,
  },
  "synth.lead": {
    id: "synth.lead",
    oscillator: "square",
    filterCutoffHz: 2_800,
    filterQ: 1,
    attackSeconds: 0.005,
    decaySeconds: 0.1,
    sustainGain: 0.7,
    releaseSeconds: 0.18,
    peakGain: 0.1,
  },
  "synth.pad": {
    id: "synth.pad",
    oscillator: "sine",
    filterCutoffHz: 1_400,
    filterQ: 1,
    attackSeconds: 0.35,
    decaySeconds: 0.4,
    sustainGain: 0.75,
    releaseSeconds: 0.8,
    peakGain: 0.1,
  },
};

export const SOUND_CATALOG: SoundCatalog = {
  drumKits: [{ id: BASIC_DRUM_KIT.id, soundIds: BASIC_DRUM_KIT.sounds.map(({ id }) => id) }],
  synthPresets: Object.values(SYNTH_PRESETS).map(({ id }) => ({ id })),
};

export const findDrumSound = (id: string): DrumSoundDefinition | undefined =>
  BASIC_DRUM_KIT.sounds.find((sound) => sound.id === id);

export const findSynthPreset = (id: string): SynthPreset | undefined =>
  Object.values(SYNTH_PRESETS).find((preset) => preset.id === id);
