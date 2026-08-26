import { isDeepStrictEqual } from "node:util";

import { emptyChangeSummary, type ChangeSummary, type Operation, type Reduction } from "./commands.ts";
import { ConflictError, NotFoundError } from "./errors.ts";
import type { Pattern, Project, SoundCatalog, Track } from "./model.ts";
import { validateProject } from "./model.ts";

type Diff = { readonly created: readonly string[]; readonly updated: readonly string[]; readonly deleted: readonly string[] };
type Event = { readonly key: string; readonly id: string; readonly value: unknown };

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
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) {
    throw new NotFoundError({ path: "operation.trackId", message: "must reference an existing track" });
  }
  return track;
};

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
    updated: after.filter((entity) => beforeById.has(entity.id) && !isDeepStrictEqual(beforeById.get(entity.id), entity)).map((entity) => entity.id),
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
    updated: after.filter((event) => beforeByKey.has(event.key) && !isDeepStrictEqual(beforeByKey.get(event.key), event.value)).map((event) => event.id),
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
      const candidate: Project = { ...project, ...operation.changes };
      if (isDeepStrictEqual(project, candidate)) return { project, changes: emptyChangeSummary() };
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
      const updatedTrack: Track = { ...track, ...operation.changes };
      if (isDeepStrictEqual(track, updatedTrack)) return { project, changes: emptyChangeSummary() };
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
  }
}
