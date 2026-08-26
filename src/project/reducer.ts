import { emptyChangeSummary, type ChangeSummary, type Operation, type Reduction } from "./commands.ts";
import { ConflictError, InvalidInputError, NotFoundError } from "./errors.ts";
import type { ArrangementClip, DrumHit, DrumPattern, Pattern, Project, SoundCatalog, SynthNote, SynthPattern, Track } from "./model.ts";
import { assertUuid, validateProject } from "./model.ts";

type Diff = { readonly created: readonly string[]; readonly updated: readonly string[]; readonly deleted: readonly string[] };
type Event = { readonly key: string; readonly id: string; readonly value: unknown };

const isJsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const withChanges = (
  changes: Partial<{ readonly created: Partial<ChangeSummary["created"]>; readonly updated: Partial<ChangeSummary["updated"]>; readonly deleted: Partial<ChangeSummary["deleted"]> }>,
): ChangeSummary => {
  const empty = emptyChangeSummary();
  return {
    created: { ...empty.created, ...changes.created },
    updated: { ...empty.updated, ...changes.updated },
    deleted: { ...empty.deleted, ...changes.deleted },
  };
};

const requireTrack = (project: Project, trackId: string): Track => {
  assertUuid(trackId, "operation.trackId");
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) {
    throw new NotFoundError({ path: "operation.trackId", message: "must reference an existing track" });
  }
  return track;
};

const requirePattern = (project: Project, patternId: string): Pattern => {
  assertUuid(patternId, "operation.patternId");
  const pattern = project.patterns.find((candidate) => candidate.id === patternId);
  if (pattern === undefined) {
    throw new NotFoundError({ path: "operation.patternId", message: "must reference an existing pattern" });
  }
  return pattern;
};

const requireArrangementClip = (project: Project, clipId: string): ArrangementClip => {
  assertUuid(clipId, "operation.clipId");
  const clip = project.arrangement.find((candidate) => candidate.id === clipId);
  if (clip === undefined) {
    throw new NotFoundError({ path: "operation.clipId", message: "must reference an existing arrangement clip" });
  }
  return clip;
};

const requireDrumPattern = (project: Project, patternId: string): DrumPattern => {
  const pattern = requirePattern(project, patternId);
  if (pattern.kind !== "drum") {
    throw new ConflictError({ path: "operation.patternId", message: "must reference a drum pattern" });
  }
  return pattern;
};

const requireSynthPattern = (project: Project, patternId: string): SynthPattern => {
  const pattern = requirePattern(project, patternId);
  if (pattern.kind !== "synth") {
    throw new ConflictError({ path: "operation.patternId", message: "must reference a synth pattern" });
  }
  return pattern;
};

const requireDrumHit = (pattern: DrumPattern, hitId: string, path: string): DrumHit => {
  assertUuid(hitId, path);
  const hit = pattern.events.find((candidate) => candidate.id === hitId);
  if (hit === undefined) {
    throw new NotFoundError({ path: "operation.hitId", message: "must reference an existing drum hit" });
  }
  return hit;
};

const requireSynthNote = (pattern: SynthPattern, noteId: string, path: string): SynthNote => {
  assertUuid(noteId, path);
  const note = pattern.events.find((candidate) => candidate.id === noteId);
  if (note === undefined) {
    throw new NotFoundError({ path: "operation.noteId", message: "must reference an existing synth note" });
  }
  return note;
};

const assertUniqueOperationIds = (ids: readonly string[], path: string): void => {
  if (new Set(ids).size !== ids.length) {
    throw new ConflictError({ path, message: "must not contain duplicate IDs" });
  }
};

const assertOperationIds = (
  ids: readonly string[],
  pathForIndex: (index: number) => string,
): void => {
  ids.forEach((id, index) => assertUuid(id, pathForIndex(index)));
};

const replacePattern = (project: Project, updatedPattern: Pattern): Project => ({
  ...project,
  patterns: project.patterns.map((pattern) => pattern.id === updatedPattern.id ? updatedPattern : pattern),
});

const copyPattern = <T extends Pattern>(
  pattern: T,
  duplicatePatternId: string,
  duplicateName: string,
  duplicateEventIds: readonly string[],
): T => ({
  ...pattern,
  id: duplicatePatternId,
  name: duplicateName,
  events: pattern.events.map((event, index) => ({ ...event, id: duplicateEventIds[index]! })),
}) as T;

const assertDrumInstrumentCompatibility = (project: Project, track: Track, catalog: SoundCatalog): void => {
  if (track.kind !== "drum") return;
  const kit = catalog.drumKits.find((candidate) => candidate.id === track.instrumentId);
  if (kit === undefined) return;
  const soundIds = new Set(kit.soundIds);
  const incompatibleHitIds: string[] = [];
  for (const pattern of project.patterns) {
    if (pattern.trackId === track.id && pattern.kind === "drum") {
      incompatibleHitIds.push(...pattern.events.filter((hit) => !soundIds.has(hit.soundId)).map((hit) => hit.id));
    }
  }
  if (incompatibleHitIds.length > 0) {
    throw new ConflictError({
      path: "operation.changes.instrumentId",
      message: "must support all existing drum hits on the track",
      relatedIds: incompatibleHitIds,
    });
  }
};

const diff = <T extends { readonly id: string }>(before: readonly T[], after: readonly T[]): Diff => {
  const beforeById = new Map(before.map((entity) => [entity.id, entity]));
  const afterById = new Map(after.map((entity) => [entity.id, entity]));
  return {
    created: after.filter((entity) => !beforeById.has(entity.id)).map((entity) => entity.id),
    updated: after.filter((entity) => beforeById.has(entity.id) && !isJsonEqual(beforeById.get(entity.id), entity)).map((entity) => entity.id),
    deleted: before.filter((entity) => !afterById.has(entity.id)).map((entity) => entity.id),
  };
};

const events = (patterns: readonly Pattern[], kind: Pattern["kind"]): readonly Event[] =>
  patterns.flatMap((pattern) =>
    pattern.kind === kind
      ? pattern.events.map((event) => ({ key: `${pattern.id}:${event.id}`, id: event.id, value: event }))
      : [],
  );

const eventDiff = (before: readonly Event[], after: readonly Event[]): Diff => {
  const beforeByKey = new Map(before.map((event) => [event.key, event.value]));
  const afterByKey = new Map(after.map((event) => [event.key, event.value]));
  return {
    created: after.filter((event) => !beforeByKey.has(event.key)).map((event) => event.id),
    updated: after.filter((event) => beforeByKey.has(event.key) && !isJsonEqual(beforeByKey.get(event.key), event.value)).map((event) => event.id),
    deleted: before.filter((event) => !afterByKey.has(event.key)).map((event) => event.id),
  };
};

export function summarizeProjectDiff(before: Project, after: Project): ChangeSummary {
  const projects = diff([before], [after]);
  const tracks = diff(before.tracks, after.tracks);
  const patterns = diff(before.patterns, after.patterns);
  const drumHits = eventDiff(events(before.patterns, "drum"), events(after.patterns, "drum"));
  const synthNotes = eventDiff(events(before.patterns, "synth"), events(after.patterns, "synth"));
  const clips = diff(before.arrangement, after.arrangement);
  return {
    created: { projectIds: projects.created, trackIds: tracks.created, patternIds: patterns.created, drumHitIds: drumHits.created, synthNoteIds: synthNotes.created, arrangementClipIds: clips.created },
    updated: { projectIds: projects.updated, trackIds: tracks.updated, patternIds: patterns.updated, drumHitIds: drumHits.updated, synthNoteIds: synthNotes.updated, arrangementClipIds: clips.updated },
    deleted: { projectIds: projects.deleted, trackIds: tracks.deleted, patternIds: patterns.deleted, drumHitIds: drumHits.deleted, synthNoteIds: synthNotes.deleted, arrangementClipIds: clips.deleted },
  };
}

export function reduceOperation(project: Project, operation: Operation, catalog: SoundCatalog): Reduction {
  switch (operation.type) {
    case "project.update": {
      const candidate: Project = {
        ...project,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.bpm === undefined ? {} : { bpm: operation.changes.bpm }),
        ...(operation.changes.masterVolumeDb === undefined ? {} : { masterVolumeDb: operation.changes.masterVolumeDb }),
      };
      if (isJsonEqual(project, candidate)) return { project, changes: emptyChangeSummary() };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { projectIds: [project.id] } }) };
    }
    case "track.create": {
      const candidate: Project = { ...project, tracks: [...project.tracks, operation.track] };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ created: { trackIds: [operation.track.id] } }) };
    }
    case "track.update": {
      const track = requireTrack(project, operation.trackId);
      const updatedTrack: Track = {
        ...track,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.instrumentId === undefined ? {} : { instrumentId: operation.changes.instrumentId }),
        ...(operation.changes.volumeDb === undefined ? {} : { volumeDb: operation.changes.volumeDb }),
        ...(operation.changes.pan === undefined ? {} : { pan: operation.changes.pan }),
        ...(operation.changes.muted === undefined ? {} : { muted: operation.changes.muted }),
        ...(operation.changes.soloed === undefined ? {} : { soloed: operation.changes.soloed }),
      };
      if (isJsonEqual(track, updatedTrack)) return { project, changes: emptyChangeSummary() };
      assertDrumInstrumentCompatibility(project, updatedTrack, catalog);
      const candidate: Project = {
        ...project,
        tracks: project.tracks.map((candidateTrack) => candidateTrack.id === track.id ? updatedTrack : candidateTrack),
      };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { trackIds: [track.id] } }) };
    }
    case "track.delete": {
      requireTrack(project, operation.trackId);
      const deletedPatterns = project.patterns.filter((pattern) => pattern.trackId === operation.trackId);
      const deletedPatternIds = new Set(deletedPatterns.map((pattern) => pattern.id));
      const deletedDrumHitIds = deletedPatterns.filter((pattern) => pattern.kind === "drum").flatMap((pattern) => pattern.events.map((event) => event.id));
      const deletedSynthNoteIds = deletedPatterns.filter((pattern) => pattern.kind === "synth").flatMap((pattern) => pattern.events.map((event) => event.id));
      const deletedClips = project.arrangement.filter((clip) => deletedPatternIds.has(clip.patternId));
      const candidate: Project = {
        ...project,
        tracks: project.tracks.filter((track) => track.id !== operation.trackId),
        patterns: project.patterns.filter((pattern) => pattern.trackId !== operation.trackId),
        arrangement: project.arrangement.filter((clip) => !deletedPatternIds.has(clip.patternId)),
      };
      validateProject(candidate, catalog);
      return {
        project: candidate,
        changes: withChanges({ deleted: {
          trackIds: [operation.trackId],
          patternIds: deletedPatterns.map((pattern) => pattern.id),
          drumHitIds: deletedDrumHitIds,
          synthNoteIds: deletedSynthNoteIds,
          arrangementClipIds: deletedClips.map((clip) => clip.id),
        } }),
      };
    }
    case "pattern.create": {
      const candidate: Project = { ...project, patterns: [...project.patterns, operation.pattern] };
      validateProject(candidate, catalog);
      return {
        project: candidate,
        changes: withChanges({ created: {
          patternIds: [operation.pattern.id],
          drumHitIds: operation.pattern.kind === "drum"
            ? operation.pattern.events.map((event) => event.id)
            : [],
          synthNoteIds: operation.pattern.kind === "synth"
            ? operation.pattern.events.map((event) => event.id)
            : [],
        } }),
      };
    }
    case "pattern.duplicate": {
      const pattern = requirePattern(project, operation.patternId);
      assertUuid(operation.duplicatePatternId, "operation.duplicatePatternId");
      assertOperationIds(
        operation.duplicateEventIds,
        (index) => `operation.duplicateEventIds[${index}]`,
      );
      const sourceEventIds = new Set(pattern.events.map((event) => event.id));
      if (
        operation.duplicateEventIds.length !== pattern.events.length
        || new Set(operation.duplicateEventIds).size !== operation.duplicateEventIds.length
        || operation.duplicateEventIds.some((eventId) => sourceEventIds.has(eventId))
      ) {
        throw new InvalidInputError({
          path: "operation.duplicateEventIds",
          message: "must contain one fresh ID for each copied event",
        });
      }
      const duplicate = copyPattern(
        pattern,
        operation.duplicatePatternId,
        operation.duplicateName,
        operation.duplicateEventIds,
      );
      const candidate: Project = { ...project, patterns: [...project.patterns, duplicate] };
      validateProject(candidate, catalog);
      return {
        project: candidate,
        changes: withChanges({ created: {
          patternIds: [duplicate.id],
          drumHitIds: duplicate.kind === "drum" ? duplicate.events.map((event) => event.id) : [],
          synthNoteIds: duplicate.kind === "synth" ? duplicate.events.map((event) => event.id) : [],
        } }),
      };
    }
    case "pattern.update": {
      const pattern = requirePattern(project, operation.patternId);
      const updatedPattern: Pattern = {
        ...pattern,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.lengthBars === undefined ? {} : { lengthBars: operation.changes.lengthBars }),
      };
      if (isJsonEqual(pattern, updatedPattern)) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, updatedPattern);
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { patternIds: [pattern.id] } }) };
    }
    case "pattern.delete": {
      const pattern = requirePattern(project, operation.patternId);
      const deletedClips = project.arrangement.filter((clip) => clip.patternId === pattern.id);
      const candidate: Project = {
        ...project,
        patterns: project.patterns.filter((candidatePattern) => candidatePattern.id !== pattern.id),
        arrangement: project.arrangement.filter((clip) => clip.patternId !== pattern.id),
      };
      validateProject(candidate, catalog);
      return {
        project: candidate,
        changes: withChanges({ deleted: {
          patternIds: [pattern.id],
          drumHitIds: pattern.kind === "drum" ? pattern.events.map((event) => event.id) : [],
          synthNoteIds: pattern.kind === "synth" ? pattern.events.map((event) => event.id) : [],
          arrangementClipIds: deletedClips.map((clip) => clip.id),
        } }),
      };
    }
    case "arrangement.place": {
      const clip: ArrangementClip = {
        id: operation.clip.id,
        patternId: operation.clip.patternId,
        startBar: operation.clip.startBar,
        repeatCount: operation.clip.repeatCount,
      };
      const candidate: Project = { ...project, arrangement: [...project.arrangement, clip] };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ created: { arrangementClipIds: [clip.id] } }) };
    }
    case "arrangement.update": {
      const clip = requireArrangementClip(project, operation.clipId);
      const updatedClip: ArrangementClip = {
        ...clip,
        ...(operation.changes.patternId === undefined ? {} : { patternId: operation.changes.patternId }),
        ...(operation.changes.startBar === undefined ? {} : { startBar: operation.changes.startBar }),
        ...(operation.changes.repeatCount === undefined ? {} : { repeatCount: operation.changes.repeatCount }),
      };
      if (isJsonEqual(clip, updatedClip)) return { project, changes: emptyChangeSummary() };
      const candidate: Project = {
        ...project,
        arrangement: project.arrangement.map((candidateClip) => candidateClip.id === clip.id ? updatedClip : candidateClip),
      };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { arrangementClipIds: [clip.id] } }) };
    }
    case "arrangement.delete": {
      const clip = requireArrangementClip(project, operation.clipId);
      const candidate: Project = {
        ...project,
        arrangement: project.arrangement.filter((candidateClip) => candidateClip.id !== clip.id),
      };
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ deleted: { arrangementClipIds: [clip.id] } }) };
    }
    case "drum-hits.add": {
      const pattern = requireDrumPattern(project, operation.patternId);
      if (operation.hits.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, { ...pattern, events: [...pattern.events, ...operation.hits] });
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ created: { drumHitIds: operation.hits.map((hit) => hit.id) } }) };
    }
    case "drum-hits.update": {
      const pattern = requireDrumPattern(project, operation.patternId);
      const hitIds = operation.updates.map((update) => update.hitId);
      assertOperationIds(hitIds, (index) => `operation.updates[${index}].hitId`);
      assertUniqueOperationIds(hitIds, "operation.updates");
      for (const [index, hitId] of hitIds.entries()) {
        requireDrumHit(pattern, hitId, `operation.updates[${index}].hitId`);
      }
      const changesById = new Map(operation.updates.map((update) => [update.hitId, update.changes]));
      const updatedPattern: DrumPattern = {
        ...pattern,
        events: pattern.events.map((hit) => {
          const changes = changesById.get(hit.id);
          return changes === undefined ? hit : {
            ...hit,
            ...(changes.soundId === undefined ? {} : { soundId: changes.soundId }),
            ...(changes.startStep === undefined ? {} : { startStep: changes.startStep }),
          };
        }),
      };
      const changedHitIds = updatedPattern.events
        .filter((hit, index) => !isJsonEqual(pattern.events[index], hit))
        .map((hit) => hit.id);
      if (changedHitIds.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, updatedPattern);
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { drumHitIds: changedHitIds } }) };
    }
    case "drum-hits.delete": {
      const pattern = requireDrumPattern(project, operation.patternId);
      assertOperationIds(operation.hitIds, (index) => `operation.hitIds[${index}]`);
      assertUniqueOperationIds(operation.hitIds, "operation.hitIds");
      for (const [index, hitId] of operation.hitIds.entries()) {
        requireDrumHit(pattern, hitId, `operation.hitIds[${index}]`);
      }
      if (operation.hitIds.length === 0) return { project, changes: emptyChangeSummary() };
      const hitIds = new Set(operation.hitIds);
      const candidate = replacePattern(project, { ...pattern, events: pattern.events.filter((hit) => !hitIds.has(hit.id)) });
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ deleted: { drumHitIds: operation.hitIds } }) };
    }
    case "synth-notes.add": {
      const pattern = requireSynthPattern(project, operation.patternId);
      if (operation.notes.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, { ...pattern, events: [...pattern.events, ...operation.notes] });
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ created: { synthNoteIds: operation.notes.map((note) => note.id) } }) };
    }
    case "synth-notes.update": {
      const pattern = requireSynthPattern(project, operation.patternId);
      const noteIds = operation.updates.map((update) => update.noteId);
      assertOperationIds(noteIds, (index) => `operation.updates[${index}].noteId`);
      assertUniqueOperationIds(noteIds, "operation.updates");
      for (const [index, noteId] of noteIds.entries()) {
        requireSynthNote(pattern, noteId, `operation.updates[${index}].noteId`);
      }
      const changesById = new Map(operation.updates.map((update) => [update.noteId, update.changes]));
      const updatedPattern: SynthPattern = {
        ...pattern,
        events: pattern.events.map((note) => {
          const changes = changesById.get(note.id);
          return changes === undefined ? note : {
            ...note,
            ...(changes.midiNote === undefined ? {} : { midiNote: changes.midiNote }),
            ...(changes.startStep === undefined ? {} : { startStep: changes.startStep }),
            ...(changes.lengthSteps === undefined ? {} : { lengthSteps: changes.lengthSteps }),
          };
        }),
      };
      const changedNoteIds = updatedPattern.events
        .filter((note, index) => !isJsonEqual(pattern.events[index], note))
        .map((note) => note.id);
      if (changedNoteIds.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, updatedPattern);
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ updated: { synthNoteIds: changedNoteIds } }) };
    }
    case "synth-notes.delete": {
      const pattern = requireSynthPattern(project, operation.patternId);
      assertOperationIds(operation.noteIds, (index) => `operation.noteIds[${index}]`);
      assertUniqueOperationIds(operation.noteIds, "operation.noteIds");
      for (const [index, noteId] of operation.noteIds.entries()) {
        requireSynthNote(pattern, noteId, `operation.noteIds[${index}]`);
      }
      if (operation.noteIds.length === 0) return { project, changes: emptyChangeSummary() };
      const noteIds = new Set(operation.noteIds);
      const candidate = replacePattern(project, { ...pattern, events: pattern.events.filter((note) => !noteIds.has(note.id)) });
      validateProject(candidate, catalog);
      return { project: candidate, changes: withChanges({ deleted: { synthNoteIds: operation.noteIds } }) };
    }
  }
}
