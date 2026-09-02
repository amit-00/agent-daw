import {
  migrateProject,
  PROJECT_CAPS,
  type ArrangementClip,
  type Pattern,
  type Project,
  type ProjectV1,
  type SoundCatalog,
  type Track,
} from "../project/index.ts";

export type DecodeProjectResult =
  | { readonly ok: true; readonly project: Project }
  | {
      readonly ok: false;
      readonly code: "corrupt_record" | "unsupported_schema";
      readonly message: string;
      readonly cause?: unknown;
    };

class ProjectDecodeError extends RangeError {}

const fail = (path: string, expectation: string): never => {
  throw new ProjectDecodeError(`${path} ${expectation}`);
};

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
};

const arrayAt = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(path, `must be an array with at most ${maximum} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(`${path}[${index}]`, "must be present");
  }
  return value;
};

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) return fail(path, "must be a non-empty string");
  return value;
};

const numberAt = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fail(path, `must be a finite number from ${minimum} through ${maximum}`);
  }
  return value;
};

const integerAt = (value: unknown, path: string, minimum: number, maximum: number): number => {
  const result = numberAt(value, path, minimum, maximum);
  if (!Number.isInteger(result)) return fail(path, "must be an integer");
  return result;
};

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") return fail(path, "must be a boolean");
  return value;
};

const uniqueIds = (entities: readonly { readonly id: string }[], path: string): void => {
  if (new Set(entities.map(({ id }) => id)).size !== entities.length) fail(path, "must contain unique IDs");
};

const nameAt = (value: unknown, path: string): string => {
  const name = stringAt(value, path);
  if (name.trim().length === 0 || name.length > 40) {
    return fail(path, "must contain non-whitespace text of at most 40 characters");
  }
  return name;
};

const readTrack = (value: unknown, path: string, catalog: SoundCatalog): Track => {
  const source = objectAt(value, path);
  const id = stringAt(source.id, `${path}.id`);
  const name = nameAt(source.name, `${path}.name`);
  const kind = source.kind;
  if (kind !== "drum" && kind !== "synth") return fail(`${path}.kind`, "must be drum or synth");
  const instrumentId = stringAt(source.instrumentId, `${path}.instrumentId`);
  const compatible = kind === "drum"
    ? catalog.drumKits.some((kit) => kit.id === instrumentId)
    : catalog.synthPresets.some((preset) => preset.id === instrumentId);
  if (!compatible) return fail(`${path}.instrumentId`, `must be a ${kind} instrument in the sound catalog`);
  const color = source.color;
  if (color !== undefined && typeof color !== "string") return fail(`${path}.color`, "must be a string");
  return {
    id,
    name,
    kind,
    instrumentId,
    volumeDb: numberAt(source.volumeDb, `${path}.volumeDb`, -60, 6),
    pan: numberAt(source.pan, `${path}.pan`, -1, 1),
    muted: booleanAt(source.muted, `${path}.muted`),
    soloed: booleanAt(source.soloed, `${path}.soloed`),
    ...(color === undefined ? {} : { color }),
  };
};

const readPattern = (value: unknown, path: string, catalog: SoundCatalog): Pattern => {
  const source = objectAt(value, path);
  const id = stringAt(source.id, `${path}.id`);
  const name = nameAt(source.name, `${path}.name`);
  const kind = source.kind;
  if (kind !== "drum" && kind !== "synth") return fail(`${path}.kind`, "must be drum or synth");
  const lengthBars = source.lengthBars;
  if (lengthBars !== 1 && lengthBars !== 2 && lengthBars !== 4) {
    return fail(`${path}.lengthBars`, "must be 1, 2, or 4");
  }
  const steps = lengthBars * 16;
  const events = arrayAt(source.events, `${path}.events`, PROJECT_CAPS.maxEventsPerPattern);
  if (kind === "drum") {
    const hits = events.map((event, index) => {
      const hit = objectAt(event, `${path}.events[${index}]`);
      const soundId = stringAt(hit.soundId, `${path}.events[${index}].soundId`);
      if (!catalog.drumKits.some((kit) => kit.soundIds.includes(soundId))) {
        return fail(`${path}.events[${index}].soundId`, "must be in the sound catalog");
      }
      return {
        id: stringAt(hit.id, `${path}.events[${index}].id`),
        soundId,
        startStep: integerAt(hit.startStep, `${path}.events[${index}].startStep`, 0, steps - 1),
      };
    });
    uniqueIds(hits, `${path}.events`);
    return { id, name, kind, lengthBars, events: hits };
  }
  const notes = events.map((event, index) => {
    const note = objectAt(event, `${path}.events[${index}]`);
    const startStep = integerAt(note.startStep, `${path}.events[${index}].startStep`, 0, steps - 1);
    const lengthSteps = integerAt(note.lengthSteps, `${path}.events[${index}].lengthSteps`, 1, steps);
    if (startStep + lengthSteps > steps) return fail(`${path}.events[${index}]`, "must end within its pattern");
    return {
      id: stringAt(note.id, `${path}.events[${index}].id`),
      midiNote: integerAt(note.midiNote, `${path}.events[${index}].midiNote`, 24, 96),
      startStep,
      lengthSteps,
    };
  });
  uniqueIds(notes, `${path}.events`);
  return { id, name, kind, lengthBars, events: notes };
};

const readClip = (value: unknown, path: string): ArrangementClip => {
  const source = objectAt(value, path);
  return {
    id: stringAt(source.id, `${path}.id`),
    patternId: stringAt(source.patternId, `${path}.patternId`),
    trackId: stringAt(source.trackId, `${path}.trackId`),
    startBar: integerAt(source.startBar, `${path}.startBar`, 0, PROJECT_CAPS.maxArrangementBars),
    repeatCount: integerAt(source.repeatCount, `${path}.repeatCount`, 1, 64),
  };
};

const readProjectV2 = (source: Record<string, unknown>, catalog: SoundCatalog): Project => {
  const tracks = arrayAt(source.tracks, "project.tracks", PROJECT_CAPS.maxTracks)
    .map((track, index) => readTrack(track, `project.tracks[${index}]`, catalog));
  const patterns = arrayAt(source.patterns, "project.patterns", PROJECT_CAPS.maxPatterns)
    .map((pattern, index) => readPattern(pattern, `project.patterns[${index}]`, catalog));
  const arrangement = arrayAt(source.arrangement, "project.arrangement", PROJECT_CAPS.maxArrangementClips)
    .map((clip, index) => readClip(clip, `project.arrangement[${index}]`));
  uniqueIds(tracks, "project.tracks");
  uniqueIds(patterns, "project.patterns");
  uniqueIds(arrangement, "project.arrangement");
  return {
    schemaVersion: 2,
    id: stringAt(source.id, "project.id"),
    name: nameAt(source.name, "project.name"),
    bpm: numberAt(source.bpm, "project.bpm", 40, 240),
    masterVolumeDb: numberAt(source.masterVolumeDb, "project.masterVolumeDb", -60, 0),
    tracks,
    patterns,
    arrangement,
  };
};

const readProjectV1 = (source: Record<string, unknown>, catalog: SoundCatalog): ProjectV1 => {
  const tracks = arrayAt(source.tracks, "project.tracks", PROJECT_CAPS.maxTracks)
    .map((track, index) => readTrack(track, `project.tracks[${index}]`, catalog));
  const patterns = arrayAt(source.patterns, "project.patterns", PROJECT_CAPS.maxPatterns)
    .map((value, index) => {
      const pattern = readPattern(value, `project.patterns[${index}]`, catalog);
      const rawPattern = objectAt(value, `project.patterns[${index}]`);
      return { ...pattern, trackId: stringAt(rawPattern.trackId, `project.patterns[${index}].trackId`) };
    });
  const arrangement = arrayAt(source.arrangement, "project.arrangement", PROJECT_CAPS.maxArrangementClips)
    .map((value, index) => {
      const clip = objectAt(value, `project.arrangement[${index}]`);
      return {
        id: stringAt(clip.id, `project.arrangement[${index}].id`),
        patternId: stringAt(clip.patternId, `project.arrangement[${index}].patternId`),
        startBar: integerAt(clip.startBar, `project.arrangement[${index}].startBar`, 0, PROJECT_CAPS.maxArrangementBars),
        repeatCount: integerAt(clip.repeatCount, `project.arrangement[${index}].repeatCount`, 1, 64),
      };
    });
  uniqueIds(tracks, "project.tracks");
  uniqueIds(patterns, "project.patterns");
  uniqueIds(arrangement, "project.arrangement");
  for (const pattern of patterns) {
    if (!tracks.some((track) => track.id === pattern.trackId)) {
      fail("project.patterns", `references missing track ${pattern.trackId}`);
    }
  }
  for (const clip of arrangement) {
    if (!patterns.some((pattern) => pattern.id === clip.patternId)) {
      fail("project.arrangement", `references missing pattern ${clip.patternId}`);
    }
  }
  return {
    schemaVersion: 1,
    id: stringAt(source.id, "project.id"),
    name: nameAt(source.name, "project.name"),
    bpm: numberAt(source.bpm, "project.bpm", 40, 240),
    masterVolumeDb: numberAt(source.masterVolumeDb, "project.masterVolumeDb", -60, 0),
    tracks,
    patterns,
    arrangement,
  };
};

const validateRelationships = (project: Project, catalog: SoundCatalog): void => {
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const patterns = new Map(project.patterns.map((pattern) => [pattern.id, pattern]));
  const clipsByTrack = new Map<string, ArrangementClip[]>();
  for (const clip of project.arrangement) {
    const track = tracks.get(clip.trackId) ?? fail("project.arrangement", `references missing track ${clip.trackId}`);
    const pattern = patterns.get(clip.patternId) ?? fail("project.arrangement", `references missing pattern ${clip.patternId}`);
    if (track.kind !== pattern.kind) fail("project.arrangement", "must pair clips with matching track and pattern kinds");
    const endBar = clip.startBar + pattern.lengthBars * clip.repeatCount;
    if (endBar > PROJECT_CAPS.maxArrangementBars) {
      fail("project.arrangement", `must end no later than bar ${PROJECT_CAPS.maxArrangementBars}`);
    }
    if (pattern.kind === "drum") {
      const kit = catalog.drumKits.find((candidate) => candidate.id === track.instrumentId);
      if (kit === undefined || !pattern.events.every((event) => kit.soundIds.includes(event.soundId))) {
        fail("project.arrangement", "must use sounds compatible with the drum track kit");
      }
    }
    const clips = clipsByTrack.get(clip.trackId) ?? [];
    clips.push(clip);
    clipsByTrack.set(clip.trackId, clips);
  }
  for (const clips of clipsByTrack.values()) {
    clips.sort((left, right) => left.startBar - right.startBar);
    let previousEnd = 0;
    for (const clip of clips) {
      const pattern = patterns.get(clip.patternId)!;
      if (clip.startBar < previousEnd) fail("project.arrangement", "must not overlap clips on the same track");
      previousEnd = clip.startBar + pattern.lengthBars * clip.repeatCount;
    }
  }
};

export function decodeProject(value: unknown, catalog: SoundCatalog): DecodeProjectResult {
  try {
    const source = objectAt(value, "project");
    const schemaVersion = source.schemaVersion;
    if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion)
      && schemaVersion !== 1 && schemaVersion !== 2) {
      return {
        ok: false,
        code: "unsupported_schema",
        message: `Project schema ${schemaVersion} is unsupported`,
      };
    }
    if (schemaVersion !== 1 && schemaVersion !== 2) fail("project.schemaVersion", "must be 1 or 2");

    const project = schemaVersion === 1
      ? migrateProject(readProjectV1(source, catalog))
      : readProjectV2(source, catalog);
    validateRelationships(project, catalog);
    return { ok: true, project };
  } catch (error: unknown) {
    if (!(error instanceof ProjectDecodeError)) throw error;
    return { ok: false, code: "corrupt_record", message: error.message, cause: error };
  }
}
