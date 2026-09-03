import { type Command, type Project, ProjectService, type Track } from "../src/project/index.ts";

export const id = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

export const blankProject = (): Project => ({
  schemaVersion: 2,
  id: id(1),
  name: "Untitled",
  bpm: 120,
  masterVolumeDb: 0,
  tracks: [],
  patterns: [],
  arrangement: [],
});

export const basicDrumTrack = (): Track => ({
  id: id(10),
  name: "Drums",
  kind: "drum",
  instrumentId: "kit.basic",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

export const bassTrack = (): Track => ({
  id: id(20),
  name: "Bass",
  kind: "synth",
  instrumentId: "synth.bass",
  volumeDb: 0,
  pan: 0,
  muted: false,
  soloed: false,
});

export const createBassTrackCommand = (commandId: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: "Create bass",
  operation: { type: "track.create", track: bassTrack() },
});

export const updateProjectNameCommand = (commandId: string, name: string): Command => ({
  kind: "operation",
  id: commandId,
  source: "manual",
  label: `Rename project to ${name}`,
  operation: { type: "project.update", changes: { name } },
});

export const createTestService = (initialProject: Project): ProjectService => {
  let nextHistoryId = 700;
  let timestamp = 1_700_000_000_000;
  return new ProjectService({
    initialProject,
    createHistoryId: () => id(nextHistoryId++),
    now: () => timestamp++,
  });
};

export const projectWithBasicDrums = (): Project => ({
  ...blankProject(),
  tracks: [basicDrumTrack()],
  patterns: [{
    id: id(11),
    name: "Beat",
    kind: "drum",
    lengthBars: 1,
    events: [{ id: id(13), soundId: "kick", startStep: 0 }],
  }],
  arrangement: [{ id: id(12), patternId: id(11), trackId: id(10), startBar: 0, repeatCount: 1 }],
});

export const projectWithBassAndDrums = (): Project => ({
  ...projectWithBasicDrums(),
  tracks: [
    basicDrumTrack(),
    {
      id: id(20),
      name: "Bass",
      kind: "synth",
      instrumentId: "synth.bass",
      volumeDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
    },
  ],
  patterns: [
    ...projectWithBasicDrums().patterns,
    {
      id: id(21),
      name: "Bass line",
      kind: "synth",
      lengthBars: 1,
      events: [{ id: id(23), midiNote: 36, startStep: 0, lengthSteps: 4 }],
    },
  ],
  arrangement: [
    ...projectWithBasicDrums().arrangement,
    { id: id(22), patternId: id(21), trackId: id(20), startBar: 0, repeatCount: 1 },
  ],
});

export const projectWithLead = (): Project => ({
  ...blankProject(),
  tracks: [{
    id: id(40),
    name: "Lead",
    kind: "synth",
    instrumentId: "synth.lead",
    volumeDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
  }],
  patterns: [{
    id: id(41),
    name: "Lead phrase",
    kind: "synth",
    lengthBars: 1,
    events: [{ id: id(42), midiNote: 60, startStep: 0, lengthSteps: 4 }],
  }],
  arrangement: [],
});
