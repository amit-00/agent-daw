import {
  ConflictError,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
} from "./errors.ts";

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalid = (path: string, message: string): never => {
  throw new InvalidInputError({ path, message });
};

const assertString = (value: string, path: string): void => {
  if (typeof value !== "string") {
    invalid(path, "must be a string");
  }
};

const assertTrimmedLength = (
  value: string,
  path: string,
  minimum: number,
  maximum: number,
): void => {
  assertString(value, path);
  const length = value.trim().length;
  if (length < minimum || length > maximum) {
    invalid(path, `must have a trimmed length between ${minimum} and ${maximum}`);
  }
};

const assertUuid = (value: EntityId, path: string): void => {
  assertString(value, path);
  if (!UUID_PATTERN.test(value)) {
    invalid(path, "must be a UUID");
  }
};

const assertFiniteRange = (
  value: number,
  path: string,
  minimum: number,
  maximum: number,
): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(path, `must be a finite number between ${minimum} and ${maximum}`);
  }
};

const assertIntegerRange = (
  value: number,
  path: string,
  minimum: number,
  maximum: number,
): void => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(path, `must be an integer between ${minimum} and ${maximum}`);
  }
};

const assertBoolean = (value: boolean, path: string): void => {
  if (typeof value !== "boolean") {
    invalid(path, "must be a boolean");
  }
};

const assertMaximum = (length: number, maximum: number, path: string): void => {
  if (length > maximum) {
    throw new LimitExceededError({ path, message: `must contain at most ${maximum} entries` });
  }
};

const assertUniqueId = (id: EntityId, path: string, ids: Set<EntityId>): void => {
  assertUuid(id, path);
  if (ids.has(id)) {
    throw new ConflictError({
      path,
      message: "must be unique within its collection",
      relatedIds: [id],
    });
  }
  ids.add(id);
};

const assertTrackInstrument = (track: Track, catalog: SoundCatalog, path: string): void => {
  assertString(track.instrumentId, path);
  const isKnown =
    track.kind === "drum"
      ? catalog.drumKits.some((kit) => kit.id === track.instrumentId)
      : catalog.synthPresets.some((preset) => preset.id === track.instrumentId);

  if (!isKnown) {
    throw new NotFoundError({ path, message: "must reference an instrument of the matching kind" });
  }
};

const validateTrack = (
  track: Track,
  index: number,
  catalog: SoundCatalog,
  ids: Set<EntityId>,
): void => {
  const path = `project.tracks[${index}]`;
  assertUniqueId(track.id, `${path}.id`, ids);
  assertTrimmedLength(track.name, `${path}.name`, 1, 40);
  if (track.kind !== "drum" && track.kind !== "synth") {
    invalid(`${path}.kind`, "must be drum or synth");
  }
  assertTrackInstrument(track, catalog, `${path}.instrumentId`);
  assertFiniteRange(track.volumeDb, `${path}.volumeDb`, -60, 6);
  assertFiniteRange(track.pan, `${path}.pan`, -1, 1);
  assertBoolean(track.muted, `${path}.muted`);
  assertBoolean(track.soloed, `${path}.soloed`);
};

const validateDrumEvent = (
  event: DrumHit,
  index: number,
  path: string,
  stepCount: number,
  soundIds: ReadonlySet<string>,
  ids: Set<EntityId>,
): void => {
  const eventPath = `${path}.events[${index}]`;
  assertUniqueId(event.id, `${eventPath}.id`, ids);
  assertString(event.soundId, `${eventPath}.soundId`);
  if (!soundIds.has(event.soundId)) {
    throw new NotFoundError({
      path: `${eventPath}.soundId`,
      message: "must reference a sound in the track drum kit",
    });
  }
  assertIntegerRange(event.startStep, `${eventPath}.startStep`, 0, stepCount - 1);
};

const validateSynthEvent = (
  event: SynthNote,
  index: number,
  path: string,
  stepCount: number,
  ids: Set<EntityId>,
): void => {
  const eventPath = `${path}.events[${index}]`;
  assertUniqueId(event.id, `${eventPath}.id`, ids);
  assertIntegerRange(event.midiNote, `${eventPath}.midiNote`, 24, 96);
  assertIntegerRange(event.startStep, `${eventPath}.startStep`, 0, stepCount - 1);
  assertIntegerRange(event.lengthSteps, `${eventPath}.lengthSteps`, 1, stepCount);
  if (event.startStep + event.lengthSteps > stepCount) {
    invalid(`${eventPath}.lengthSteps`, "must end within the pattern");
  }
};

const validatePattern = (
  pattern: Pattern,
  index: number,
  tracks: ReadonlyMap<EntityId, Track>,
  catalog: SoundCatalog,
  ids: Set<EntityId>,
): void => {
  const path = `project.patterns[${index}]`;
  assertUniqueId(pattern.id, `${path}.id`, ids);
  assertUuid(pattern.trackId, `${path}.trackId`);
  assertTrimmedLength(pattern.name, `${path}.name`, 1, 40);
  if (pattern.kind !== "drum" && pattern.kind !== "synth") {
    invalid(`${path}.kind`, "must be drum or synth");
  }
  if (pattern.lengthBars !== 1 && pattern.lengthBars !== 2 && pattern.lengthBars !== 4) {
    invalid(`${path}.lengthBars`, "must be 1, 2, or 4");
  }
  assertMaximum(pattern.events.length, PROJECT_CAPS.maxEventsPerPattern, `${path}.events`);

  const track = tracks.get(pattern.trackId);
  if (track === undefined) {
    throw new NotFoundError({ path: `${path}.trackId`, message: "must reference an existing track" });
  }
  if (track.kind !== pattern.kind) {
    throw new ConflictError({
      path: `${path}.kind`,
      message: "must match its owning track kind",
      relatedIds: [track.id],
    });
  }

  const stepCount = pattern.lengthBars * 16;
  const eventIds = new Set<EntityId>();
  if (pattern.kind === "drum") {
    const kit = catalog.drumKits.find((candidate) => candidate.id === track.instrumentId);
    if (kit === undefined) {
      throw new NotFoundError({
        path: `${path}.trackId`,
        message: "must reference a track with an existing drum kit",
      });
    }
    const soundIds = new Set(kit.soundIds);
    for (const [eventIndex, event] of pattern.events.entries()) {
      validateDrumEvent(event, eventIndex, path, stepCount, soundIds, eventIds);
    }
    return;
  }

  for (const [eventIndex, event] of pattern.events.entries()) {
    validateSynthEvent(event, eventIndex, path, stepCount, eventIds);
  }
};

export function validateProject(project: Project, catalog: SoundCatalog): void {
  if (project.schemaVersion !== 1) {
    invalid("project.schemaVersion", "must equal 1");
  }
  assertUuid(project.id, "project.id");
  assertTrimmedLength(project.name, "project.name", 1, 80);
  assertFiniteRange(project.bpm, "project.bpm", 40, 240);
  assertFiniteRange(project.masterVolumeDb, "project.masterVolumeDb", -60, 0);
  assertMaximum(project.tracks.length, PROJECT_CAPS.maxTracks, "project.tracks");
  assertMaximum(project.patterns.length, PROJECT_CAPS.maxPatterns, "project.patterns");
  assertMaximum(
    project.arrangement.length,
    PROJECT_CAPS.maxArrangementClips,
    "project.arrangement",
  );

  const trackIds = new Set<EntityId>();
  const tracks = new Map<EntityId, Track>();
  for (const [index, track] of project.tracks.entries()) {
    validateTrack(track, index, catalog, trackIds);
    tracks.set(track.id, track);
  }

  const patternIds = new Set<EntityId>();
  const patterns = new Map<EntityId, Pattern>();
  for (const [index, pattern] of project.patterns.entries()) {
    validatePattern(pattern, index, tracks, catalog, patternIds);
    patterns.set(pattern.id, pattern);
  }

  const clipIds = new Set<EntityId>();
  const clipsByTrack = new Map<EntityId, ArrangementClip[]>();
  for (const [index, clip] of project.arrangement.entries()) {
    const path = `project.arrangement[${index}]`;
    assertUniqueId(clip.id, `${path}.id`, clipIds);
    assertUuid(clip.patternId, `${path}.patternId`);
    assertIntegerRange(clip.startBar, `${path}.startBar`, 0, PROJECT_CAPS.maxArrangementBars);
    assertIntegerRange(clip.repeatCount, `${path}.repeatCount`, 1, 64);

    const pattern = patterns.get(clip.patternId);
    if (pattern === undefined) {
      throw new NotFoundError({ path: `${path}.patternId`, message: "must reference an existing pattern" });
    }
    const endBar = clip.startBar + pattern.lengthBars * clip.repeatCount;
    if (endBar > PROJECT_CAPS.maxArrangementBars) {
      invalid(`${path}.repeatCount`, "must end at or before arrangement bar 256");
    }

    const peers = clipsByTrack.get(pattern.trackId) ?? [];
    for (const peer of peers) {
      const peerPattern = patterns.get(peer.patternId);
      if (peerPattern === undefined) {
        throw new NotFoundError({ path: `${path}.patternId`, message: "must reference an existing pattern" });
      }
      const peerEndBar = peer.startBar + peerPattern.lengthBars * peer.repeatCount;
      if (clip.startBar < peerEndBar && peer.startBar < endBar) {
        throw new ConflictError({
          path,
          message: "must not overlap another clip on the same track",
          relatedIds: [peer.id, clip.id],
        });
      }
    }
    peers.push(clip);
    clipsByTrack.set(pattern.trackId, peers);
  }
}
