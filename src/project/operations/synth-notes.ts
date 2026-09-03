import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { Project, SynthNote, SynthPattern } from "../model.ts";
import { isJsonEqual, replacePattern, unsupportedOperation, withChanges } from "./shared.ts";

export type SynthNoteOperation =
  | { readonly type: "synth-notes.add"; readonly patternId: string; readonly notes: readonly SynthNote[] }
  | {
      readonly type: "synth-notes.update";
      readonly patternId: string;
      readonly updates: readonly {
        readonly noteId: string;
        readonly changes: {
          readonly midiNote?: number;
          readonly startStep?: number;
          readonly lengthSteps?: number;
        };
      }[];
    }
  | { readonly type: "synth-notes.delete"; readonly patternId: string; readonly noteIds: readonly string[] };

export function reduceSynthNoteOperation(project: Project, operation: SynthNoteOperation): Reduction {
  switch (operation.type) {
    case "synth-notes.add": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as SynthPattern;
      if (operation.notes.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, { ...pattern, events: [...pattern.events, ...operation.notes] });
      return { project: candidate, changes: withChanges({ created: { synthNoteIds: operation.notes.map((note) => note.id) } }) };
    }
    case "synth-notes.update": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as SynthPattern;
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
      return { project: candidate, changes: withChanges({ updated: { synthNoteIds: changedNoteIds } }) };
    }
    case "synth-notes.delete": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as SynthPattern;
      if (operation.noteIds.length === 0) return { project, changes: emptyChangeSummary() };
      const noteIds = new Set(operation.noteIds);
      const candidate = replacePattern(project, { ...pattern, events: pattern.events.filter((note) => !noteIds.has(note.id)) });
      return { project: candidate, changes: withChanges({ deleted: { synthNoteIds: operation.noteIds } }) };
    }
  }
  return unsupportedOperation(operation);
}
