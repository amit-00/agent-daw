import { mergeChangeSummaries, type ChangeSummary, type Operation, type Reduction } from "./commands.ts";
import type { ArrangementClip, DrumHit, DrumPattern, Pattern, Project, SoundCatalog, SynthNote, SynthPattern, Track } from "./model.ts";
import { PROJECT_CAPS } from "./model.ts";
import { reduceOperation } from "./reducer.ts";

export type ProjectValidationCode =
  | "TRACK_NOT_FOUND"
  | "PATTERN_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "HIT_NOT_FOUND"
  | "NOTE_NOT_FOUND"
  | "OUT_OF_RANGE"
  | "KIND_MISMATCH"
  | "INCOMPATIBLE_INSTRUMENT"
  | "CLIP_OVERLAP"
  | "CAPACITY_EXCEEDED";

export class ProjectValidationError extends Error {
  readonly code: ProjectValidationCode;
  readonly field: string;

  constructor(code: ProjectValidationCode, field: string, message: string) {
    super(message);
    this.name = "ProjectValidationError";
    this.code = code;
    this.field = field;
  }
}

const fail = (code: ProjectValidationCode, field: string, message: string): never => {
  throw new ProjectValidationError(code, field, message);
};

const hasChanges = (changes: object, keys: readonly string[]): boolean =>
  keys.some((key) => Reflect.get(changes, key) !== undefined);

const projectChangeKeys = ["name", "bpm", "masterVolumeDb"] as const;
const trackChangeKeys = ["name", "instrumentId", "volumeDb", "pan", "muted", "soloed"] as const;
const patternChangeKeys = ["name", "lengthBars"] as const;
const arrangementChangeKeys = ["patternId", "trackId", "startBar", "repeatCount"] as const;
const drumHitChangeKeys = ["soundId", "startStep"] as const;
const synthNoteChangeKeys = ["midiNote", "startStep", "lengthSteps"] as const;

const definedChanges = <T extends object>(changes: T): Partial<T> =>
  Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<T>;

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

const validateName = (value: string, field: string, maximum: number): void => {
  if (value.trim().length < 1 || value.trim().length > maximum) {
    fail("OUT_OF_RANGE", field, `${field} must contain 1 to ${maximum} non-whitespace characters.`);
  }
};

const validateFiniteRange = (value: number, field: string, minimum: number, maximum: number): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail("OUT_OF_RANGE", field, `${field} must be a finite number from ${minimum} to ${maximum}.`);
  }
};

const validateIntegerRange = (value: number, field: string, minimum: number, maximum: number): void => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("OUT_OF_RANGE", field, `${field} must be an integer from ${minimum} to ${maximum}.`);
  }
};

const validateLengthBars = (value: number, field: string): void => {
  if (value !== 1 && value !== 2 && value !== 4) {
    fail("OUT_OF_RANGE", field, `${field} must be 1, 2, or 4.`);
  }
};

const stepsIn = (pattern: Pattern): number => pattern.lengthBars * 16;

const findTrack = (project: Project, trackId: string): Track => {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  return track ?? fail("TRACK_NOT_FOUND", "track_id", `Track ${trackId} was not found.`);
};

const findPattern = (project: Project, patternId: string): Pattern => {
  const pattern = project.patterns.find((candidate) => candidate.id === patternId);
  return pattern ?? fail("PATTERN_NOT_FOUND", "pattern_id", `Pattern ${patternId} was not found.`);
};

const findClip = (project: Project, clipId: string): ArrangementClip => {
  const clip = project.arrangement.find((candidate) => candidate.id === clipId);
  return clip ?? fail("CLIP_NOT_FOUND", "clip_id", `Clip ${clipId} was not found.`);
};

const findDrumPattern = (project: Project, patternId: string): DrumPattern => {
  const pattern = findPattern(project, patternId);
  if (pattern.kind === "drum") return pattern;
  return fail("KIND_MISMATCH", "pattern_id", `Pattern ${patternId} is not a drum pattern.`);
};

const findSynthPattern = (project: Project, patternId: string): SynthPattern => {
  const pattern = findPattern(project, patternId);
  if (pattern.kind === "synth") return pattern;
  return fail("KIND_MISMATCH", "pattern_id", `Pattern ${patternId} is not a synth pattern.`);
};

const findDrumKit = (catalog: SoundCatalog, instrumentId: string): SoundCatalog["drumKits"][number] => {
  const kit = catalog.drumKits.find((candidate) => candidate.id === instrumentId);
  return kit ?? fail("INCOMPATIBLE_INSTRUMENT", "instrument_id", `Drum kit ${instrumentId} is not in the catalog.`);
};

const validateTrackInstrument = (track: Track, catalog: SoundCatalog): void => {
  if (track.kind === "drum") {
    findDrumKit(catalog, track.instrumentId);
    return;
  }
  if (!catalog.synthPresets.some((preset) => preset.id === track.instrumentId)) {
    fail("INCOMPATIBLE_INSTRUMENT", "instrument_id", `Synth preset ${track.instrumentId} is not in the catalog.`);
  }
};

const validateDrumHit = (hit: DrumHit, pattern: DrumPattern, catalog: SoundCatalog, field: string): void => {
  if (!catalog.drumKits.some((kit) => kit.soundIds.includes(hit.soundId))) {
    fail("INCOMPATIBLE_INSTRUMENT", `${field}.sound_id`, `Sound ${hit.soundId} is not in the catalog.`);
  }
  validateIntegerRange(hit.startStep, `${field}.step`, 0, stepsIn(pattern) - 1);
};

const validateSynthNote = (note: SynthNote, pattern: SynthPattern, field: string): void => {
  validateIntegerRange(note.midiNote, `${field}.midi_note`, 24, 96);
  validateIntegerRange(note.startStep, `${field}.step`, 0, stepsIn(pattern) - 1);
  if (!Number.isInteger(note.lengthSteps) || note.lengthSteps < 1 || note.startStep + note.lengthSteps > stepsIn(pattern)) {
    fail("OUT_OF_RANGE", `${field}.length_steps`, `${field}.length_steps must end within the pattern.`);
  }
};

const validateDrumPattern = (pattern: DrumPattern, catalog: SoundCatalog): void => {
  if (pattern.events.length > PROJECT_CAPS.maxEventsPerPattern) {
    fail("CAPACITY_EXCEEDED", "events", `A pattern supports ${PROJECT_CAPS.maxEventsPerPattern} events.`);
  }
  for (const [index, hit] of pattern.events.entries()) {
    if (pattern.events.some((candidate, candidateIndex) => candidateIndex < index && candidate.id === hit.id)) {
      fail("OUT_OF_RANGE", `events[${index}].id`, "Event ids must be unique within a pattern.");
    }
    validateDrumHit(hit, pattern, catalog, `events[${index}]`);
  }
};

const validateSynthPattern = (pattern: SynthPattern): void => {
  if (pattern.events.length > PROJECT_CAPS.maxEventsPerPattern) {
    fail("CAPACITY_EXCEEDED", "events", `A pattern supports ${PROJECT_CAPS.maxEventsPerPattern} events.`);
  }
  for (const [index, note] of pattern.events.entries()) {
    if (pattern.events.some((candidate, candidateIndex) => candidateIndex < index && candidate.id === note.id)) {
      fail("OUT_OF_RANGE", `events[${index}].id`, "Event ids must be unique within a pattern.");
    }
    validateSynthNote(note, pattern, `events[${index}]`);
  }
};

const validatePattern = (pattern: Pattern, catalog: SoundCatalog): void => {
  validateName(pattern.name, "name", 40);
  validateLengthBars(pattern.lengthBars, "length_bars");
  if (pattern.kind === "drum") validateDrumPattern(pattern, catalog);
  else validateSynthPattern(pattern);
};

const validateTrackPlacements = (project: Project, trackId: string, instrumentId: string, catalog: SoundCatalog): void => {
  const kit = findDrumKit(catalog, instrumentId);
  for (const clip of project.arrangement) {
    if (clip.trackId !== trackId) continue;
    const pattern = project.patterns.find((candidate) => candidate.id === clip.patternId);
    if (pattern?.kind === "drum" && pattern.events.some((hit) => !kit.soundIds.includes(hit.soundId))) {
      fail("INCOMPATIBLE_INSTRUMENT", "instrument_id", `Drum kit ${instrumentId} does not support every placed sound.`);
    }
  }
};

const placementEnd = (clip: ArrangementClip, pattern: Pattern): number =>
  clip.startBar + pattern.lengthBars * clip.repeatCount;

const validatePlacement = (
  project: Project,
  clip: ArrangementClip,
  catalog: SoundCatalog,
  ignoredClipId?: string,
): void => {
  const pattern = findPattern(project, clip.patternId);
  const track = findTrack(project, clip.trackId);
  if (pattern.kind !== track.kind) fail("KIND_MISMATCH", "track_id", "A clip pattern and track must have the same kind.");
  validateIntegerRange(clip.startBar, "start_bar", 0, PROJECT_CAPS.maxArrangementBars - 1);
  validateIntegerRange(clip.repeatCount, "repeat_count", 1, 64);
  const end = placementEnd(clip, pattern);
  if (end > PROJECT_CAPS.maxArrangementBars) {
    fail("OUT_OF_RANGE", "repeat_count", `A clip must end within ${PROJECT_CAPS.maxArrangementBars} bars.`);
  }
  if (track.kind === "drum") {
    const kit = findDrumKit(catalog, track.instrumentId);
    if (pattern.kind === "drum" && pattern.events.some((hit) => !kit.soundIds.includes(hit.soundId))) {
      fail("INCOMPATIBLE_INSTRUMENT", "track_id", "The drum kit does not support every pattern sound.");
    }
  }
  for (const other of project.arrangement) {
    if (other.id === ignoredClipId || other.trackId !== clip.trackId) continue;
    const otherPattern = findPattern(project, other.patternId);
    if (clip.startBar < placementEnd(other, otherPattern) && other.startBar < end) {
      fail("CLIP_OVERLAP", "start_bar", "Clips on the same track cannot overlap.");
    }
  }
};

const validatePatternLengthCandidate = (project: Project, pattern: Pattern, catalog: SoundCatalog): void => {
  const previous = findPattern(project, pattern.id);
  if (pattern.lengthBars < previous.lengthBars && previous.events.some((event) => {
    const end = "lengthSteps" in event ? event.startStep + event.lengthSteps : event.startStep + 1;
    return end > pattern.lengthBars * 16;
  })) {
    fail("OUT_OF_RANGE", "length_bars", "A shorter pattern cannot truncate events.");
  }
  validatePattern(pattern, catalog);
  const candidate: Project = {
    ...project,
    patterns: project.patterns.map((item) => item.id === pattern.id ? pattern : item),
  };
  for (const clip of candidate.arrangement.filter((item) => item.patternId === pattern.id)) {
    validatePlacement(candidate, clip, catalog, clip.id);
  }
};

const validateDrumResult = (project: Project, pattern: DrumPattern, catalog: SoundCatalog): void => {
  validateDrumPattern(pattern, catalog);
  const candidate: Project = {
    ...project,
    patterns: project.patterns.map((item) => item.id === pattern.id ? pattern : item),
  };
  for (const clip of candidate.arrangement.filter((item) => item.patternId === pattern.id)) {
    const track = findTrack(candidate, clip.trackId);
    if (track.kind === "drum") validateTrackPlacements(candidate, track.id, track.instrumentId, catalog);
  }
};

const assertArraySize = (values: readonly unknown[], field: string): void => {
  if (values.length < 1 || values.length > PROJECT_CAPS.maxEventsPerPattern) {
    fail("OUT_OF_RANGE", field, `${field} must contain 1 to ${PROJECT_CAPS.maxEventsPerPattern} items.`);
  }
};

export function validateOperation(project: Project, operation: Operation, soundCatalog: SoundCatalog): Reduction {
  switch (operation.type) {
    case "project.update":
      if (!hasChanges(operation.changes, projectChangeKeys)) fail("OUT_OF_RANGE", "changes", "At least one project field is required.");
      if (operation.changes.name !== undefined) validateName(operation.changes.name, "name", 80);
      if (operation.changes.bpm !== undefined) validateFiniteRange(operation.changes.bpm, "bpm", 40, 240);
      if (operation.changes.masterVolumeDb !== undefined) validateFiniteRange(operation.changes.masterVolumeDb, "master_volume_db", -60, 0);
      break;
    case "track.create":
      if (project.tracks.some((track) => track.id === operation.track.id)) fail("OUT_OF_RANGE", "track.id", "Track ids must be unique.");
      if (project.tracks.length >= PROJECT_CAPS.maxTracks) fail("CAPACITY_EXCEEDED", "tracks", `A project supports ${PROJECT_CAPS.maxTracks} tracks.`);
      validateName(operation.track.name, "name", 40);
      validateTrackInstrument(operation.track, soundCatalog);
      validateFiniteRange(operation.track.volumeDb, "volume_db", -60, 6);
      validateFiniteRange(operation.track.pan, "pan", -1, 1);
      break;
    case "track.update": {
      const track = findTrack(project, operation.trackId);
      if (!hasChanges(operation.changes, trackChangeKeys)) fail("OUT_OF_RANGE", "changes", "At least one track field is required.");
      const candidate: Track = { ...track, ...definedChanges(operation.changes) };
      validateName(candidate.name, "name", 40);
      validateTrackInstrument(candidate, soundCatalog);
      validateFiniteRange(candidate.volumeDb, "volume_db", -60, 6);
      validateFiniteRange(candidate.pan, "pan", -1, 1);
      if (candidate.kind === "drum") validateTrackPlacements(project, candidate.id, candidate.instrumentId, soundCatalog);
      break;
    }
    case "track.reorder":
      findTrack(project, operation.trackId);
      validateIntegerRange(operation.toIndex, "to_index", 0, project.tracks.length - 1);
      break;
    case "track.delete":
      findTrack(project, operation.trackId);
      break;
    case "pattern.create":
      if (project.patterns.some((pattern) => pattern.id === operation.pattern.id)) fail("OUT_OF_RANGE", "pattern.id", "Pattern ids must be unique.");
      if (project.patterns.length >= PROJECT_CAPS.maxPatterns) fail("CAPACITY_EXCEEDED", "patterns", `A project supports ${PROJECT_CAPS.maxPatterns} patterns.`);
      validatePattern(operation.pattern, soundCatalog);
      break;
    case "pattern.duplicate": {
      const source = findPattern(project, operation.patternId);
      if (project.patterns.some((pattern) => pattern.id === operation.duplicatePatternId)) fail("OUT_OF_RANGE", "duplicate_pattern_id", "Pattern ids must be unique.");
      if (project.patterns.length >= PROJECT_CAPS.maxPatterns) fail("CAPACITY_EXCEEDED", "patterns", `A project supports ${PROJECT_CAPS.maxPatterns} patterns.`);
      validateName(operation.duplicateName, "duplicate_name", 40);
      if (operation.duplicateEventIds.length !== source.events.length || !unique(operation.duplicateEventIds)) {
        fail("OUT_OF_RANGE", "duplicate_event_ids", "Duplicate event ids must be unique and match the source count.");
      }
      break;
    }
    case "pattern.update": {
      const pattern = findPattern(project, operation.patternId);
      if (!hasChanges(operation.changes, patternChangeKeys)) fail("OUT_OF_RANGE", "changes", "At least one pattern field is required.");
      const candidate = { ...pattern, ...definedChanges(operation.changes) } as Pattern;
      validatePatternLengthCandidate(project, candidate, soundCatalog);
      break;
    }
    case "pattern.delete":
      findPattern(project, operation.patternId);
      break;
    case "arrangement.place":
      if (project.arrangement.some((clip) => clip.id === operation.clip.id)) fail("OUT_OF_RANGE", "clip.id", "Clip ids must be unique.");
      if (project.arrangement.length >= PROJECT_CAPS.maxArrangementClips) fail("CAPACITY_EXCEEDED", "arrangement", `A project supports ${PROJECT_CAPS.maxArrangementClips} clips.`);
      validatePlacement(project, operation.clip, soundCatalog);
      break;
    case "arrangement.update": {
      const clip = findClip(project, operation.clipId);
      if (!hasChanges(operation.changes, arrangementChangeKeys)) fail("OUT_OF_RANGE", "changes", "At least one clip field is required.");
      validatePlacement(project, { ...clip, ...definedChanges(operation.changes) }, soundCatalog, clip.id);
      break;
    }
    case "arrangement.delete":
      findClip(project, operation.clipId);
      break;
    case "drum-hits.add": {
      const pattern = findDrumPattern(project, operation.patternId);
      assertArraySize(operation.hits, "hits");
      const existingIds = new Set(pattern.events.map((hit) => hit.id));
      for (const [index, hit] of operation.hits.entries()) {
        if (existingIds.has(hit.id) || operation.hits.some((candidate, candidateIndex) => candidateIndex < index && candidate.id === hit.id)) {
          fail("OUT_OF_RANGE", `hits[${index}].id`, "Hit ids must be new and unique.");
        }
        validateDrumHit(hit, pattern, soundCatalog, `hits[${index}]`);
      }
      if (pattern.events.length + operation.hits.length > PROJECT_CAPS.maxEventsPerPattern) fail("CAPACITY_EXCEEDED", "hits", `A pattern supports ${PROJECT_CAPS.maxEventsPerPattern} events.`);
      validateDrumResult(project, { ...pattern, events: [...pattern.events, ...operation.hits] }, soundCatalog);
      break;
    }
    case "drum-hits.update": {
      const pattern = findDrumPattern(project, operation.patternId);
      assertArraySize(operation.updates, "updates");
      const updates = new Map<string, { readonly soundId?: string; readonly startStep?: number }>();
      for (const [index, update] of operation.updates.entries()) {
        if (updates.has(update.hitId)) fail("OUT_OF_RANGE", `updates[${index}].hit_id`, "Hit ids must be unique.");
        if (!hasChanges(update.changes, drumHitChangeKeys)) fail("OUT_OF_RANGE", `updates[${index}].changes`, "Each hit update needs a change.");
        if (!pattern.events.some((hit) => hit.id === update.hitId)) fail("HIT_NOT_FOUND", `updates[${index}].hit_id`, `Hit ${update.hitId} was not found.`);
        updates.set(update.hitId, definedChanges(update.changes));
      }
      const candidate = { ...pattern, events: pattern.events.map((hit) => ({ ...hit, ...updates.get(hit.id) })) };
      validateDrumResult(project, candidate, soundCatalog);
      break;
    }
    case "drum-hits.delete": {
      const pattern = findDrumPattern(project, operation.patternId);
      assertArraySize(operation.hitIds, "hit_ids");
      for (const [index, hitId] of operation.hitIds.entries()) {
        if (operation.hitIds.indexOf(hitId) !== index) fail("OUT_OF_RANGE", `hit_ids[${index}]`, "Hit ids must be unique.");
        if (!pattern.events.some((hit) => hit.id === hitId)) fail("HIT_NOT_FOUND", `hit_ids[${index}]`, `Hit ${hitId} was not found.`);
      }
      break;
    }
    case "synth-notes.add": {
      const pattern = findSynthPattern(project, operation.patternId);
      assertArraySize(operation.notes, "notes");
      const existingIds = new Set(pattern.events.map((note) => note.id));
      for (const [index, note] of operation.notes.entries()) {
        if (existingIds.has(note.id) || operation.notes.some((candidate, candidateIndex) => candidateIndex < index && candidate.id === note.id)) {
          fail("OUT_OF_RANGE", `notes[${index}].id`, "Note ids must be new and unique.");
        }
        validateSynthNote(note, pattern, `notes[${index}]`);
      }
      if (pattern.events.length + operation.notes.length > PROJECT_CAPS.maxEventsPerPattern) fail("CAPACITY_EXCEEDED", "notes", `A pattern supports ${PROJECT_CAPS.maxEventsPerPattern} events.`);
      break;
    }
    case "synth-notes.update": {
      const pattern = findSynthPattern(project, operation.patternId);
      assertArraySize(operation.updates, "updates");
      const updates = new Map<string, { readonly midiNote?: number; readonly startStep?: number; readonly lengthSteps?: number }>();
      for (const [index, update] of operation.updates.entries()) {
        if (updates.has(update.noteId)) fail("OUT_OF_RANGE", `updates[${index}].note_id`, "Note ids must be unique.");
        if (!hasChanges(update.changes, synthNoteChangeKeys)) fail("OUT_OF_RANGE", `updates[${index}].changes`, "Each note update needs a change.");
        if (!pattern.events.some((note) => note.id === update.noteId)) fail("NOTE_NOT_FOUND", `updates[${index}].note_id`, `Note ${update.noteId} was not found.`);
        updates.set(update.noteId, definedChanges(update.changes));
      }
      const candidate = { ...pattern, events: pattern.events.map((note) => ({ ...note, ...updates.get(note.id) })) };
      validateSynthPattern(candidate);
      break;
    }
    case "synth-notes.delete": {
      const pattern = findSynthPattern(project, operation.patternId);
      assertArraySize(operation.noteIds, "note_ids");
      for (const [index, noteId] of operation.noteIds.entries()) {
        if (operation.noteIds.indexOf(noteId) !== index) fail("OUT_OF_RANGE", `note_ids[${index}]`, "Note ids must be unique.");
        if (!pattern.events.some((note) => note.id === noteId)) fail("NOTE_NOT_FOUND", `note_ids[${index}]`, `Note ${noteId} was not found.`);
      }
      break;
    }
  }
  return reduceOperation(project, operation);
}

export function validateOperations(
  project: Project,
  operations: readonly Operation[],
  soundCatalog: SoundCatalog,
): Reduction {
  let candidate = project;
  const summaries: ChangeSummary[] = [];
  for (const operation of operations) {
    const reduction = validateOperation(candidate, operation, soundCatalog);
    candidate = reduction.project;
    summaries.push(reduction.changes);
  }
  return { project: candidate, changes: mergeChangeSummaries(summaries) };
}
