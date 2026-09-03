import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { Pattern, PatternLengthBars, Project } from "../model.ts";
import { isJsonEqual, replacePattern, unsupportedOperation, withChanges } from "./shared.ts";

export type PatternOperation =
  | { readonly type: "pattern.create"; readonly pattern: Pattern }
  | {
      readonly type: "pattern.duplicate";
      readonly patternId: string;
      readonly duplicatePatternId: string;
      readonly duplicateName: string;
      readonly duplicateEventIds: readonly string[];
    }
  | {
      readonly type: "pattern.update";
      readonly patternId: string;
      readonly changes: { readonly name?: string; readonly lengthBars?: PatternLengthBars };
    }
  | { readonly type: "pattern.delete"; readonly patternId: string };

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

export function reducePatternOperation(project: Project, operation: PatternOperation): Reduction {
  switch (operation.type) {
    case "pattern.create": {
      const candidate: Project = { ...project, patterns: [...project.patterns, operation.pattern] };
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
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId)!;
      const duplicate = copyPattern(
        pattern,
        operation.duplicatePatternId,
        operation.duplicateName,
        operation.duplicateEventIds,
      );
      const candidate: Project = { ...project, patterns: [...project.patterns, duplicate] };
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
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId)!;
      const updatedPattern: Pattern = {
        ...pattern,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.lengthBars === undefined ? {} : { lengthBars: operation.changes.lengthBars }),
      };
      if (isJsonEqual(pattern, updatedPattern)) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, updatedPattern);
      return { project: candidate, changes: withChanges({ updated: { patternIds: [pattern.id] } }) };
    }
    case "pattern.delete": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId)!;
      const deletedClips = project.arrangement.filter((clip) => clip.patternId === pattern.id);
      const candidate: Project = {
        ...project,
        patterns: project.patterns.filter((candidatePattern) => candidatePattern.id !== pattern.id),
        arrangement: project.arrangement.filter((clip) => clip.patternId !== pattern.id),
      };
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
  }
  return unsupportedOperation(operation);
}
