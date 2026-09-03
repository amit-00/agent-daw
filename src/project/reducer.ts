import { type ChangeSummary, type Operation, type Reduction } from "./commands.ts";
import { reduceArrangementOperation } from "./operations/arrangement.ts";
import { reduceDrumHitOperation } from "./operations/drum-hits.ts";
import { reducePatternOperation } from "./operations/pattern.ts";
import { reduceProjectOperation } from "./operations/project.ts";
import { isJsonEqual, unsupportedOperation } from "./operations/shared.ts";
import { reduceSynthNoteOperation } from "./operations/synth-notes.ts";
import { reduceTrackOperation } from "./operations/track.ts";
import type { Pattern, Project } from "./model.ts";

type Diff = { readonly created: readonly string[]; readonly updated: readonly string[]; readonly deleted: readonly string[] };
type Event = { readonly key: string; readonly id: string; readonly value: unknown };

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

export function reduceOperation(project: Project, operation: Operation): Reduction {
  switch (operation.type) {
    case "project.update":
      return reduceProjectOperation(project, operation);
    case "track.create":
    case "track.update":
    case "track.delete":
    case "track.reorder":
      return reduceTrackOperation(project, operation);
    case "pattern.create":
    case "pattern.duplicate":
    case "pattern.update":
    case "pattern.delete":
      return reducePatternOperation(project, operation);
    case "arrangement.place":
    case "arrangement.update":
    case "arrangement.delete":
      return reduceArrangementOperation(project, operation);
    case "drum-hits.add":
    case "drum-hits.update":
    case "drum-hits.delete":
      return reduceDrumHitOperation(project, operation);
    case "synth-notes.add":
    case "synth-notes.update":
    case "synth-notes.delete":
      return reduceSynthNoteOperation(project, operation);
  }
  return unsupportedOperation(operation);
}
