import type { Project } from "../src/project/index.ts";

export const audioProject = (): Project => ({
  schemaVersion: 2,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Audio test",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Drums",
      kind: "drum",
      instrumentId: "kit.basic",
      volumeDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Bass",
      kind: "synth",
      instrumentId: "synth.bass",
      volumeDb: -6,
      pan: 0,
      muted: false,
      soloed: false,
    },
  ],
  patterns: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Beat",
      kind: "drum",
      lengthBars: 1,
      events: [
        { id: "00000000-0000-4000-8000-000000000005", soundId: "kick", startStep: 0 },
        { id: "00000000-0000-4000-8000-000000000006", soundId: "snare", startStep: 4 },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000007",
      name: "Bass note",
      kind: "synth",
      lengthBars: 1,
      events: [
        {
          id: "00000000-0000-4000-8000-000000000008",
          midiNote: 48,
          startStep: 4,
          lengthSteps: 8,
        },
      ],
    },
  ],
  arrangement: [
    {
      id: "00000000-0000-4000-8000-000000000009",
      patternId: "00000000-0000-4000-8000-000000000004",
      trackId: "00000000-0000-4000-8000-000000000002",
      startBar: 0,
      repeatCount: 2,
    },
    {
      id: "00000000-0000-4000-8000-000000000010",
      patternId: "00000000-0000-4000-8000-000000000007",
      trackId: "00000000-0000-4000-8000-000000000003",
      startBar: 2,
      repeatCount: 1,
    },
  ],
});
