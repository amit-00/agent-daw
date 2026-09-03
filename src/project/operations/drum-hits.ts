import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { DrumHit, DrumPattern, Project } from "../model.ts";
import { isJsonEqual, replacePattern, unsupportedOperation, withChanges } from "./shared.ts";

export type DrumHitOperation =
  | { readonly type: "drum-hits.add"; readonly patternId: string; readonly hits: readonly DrumHit[] }
  | {
      readonly type: "drum-hits.update";
      readonly patternId: string;
      readonly updates: readonly {
        readonly hitId: string;
        readonly changes: { readonly soundId?: string; readonly startStep?: number };
      }[];
    }
  | { readonly type: "drum-hits.delete"; readonly patternId: string; readonly hitIds: readonly string[] };

export function reduceDrumHitOperation(project: Project, operation: DrumHitOperation): Reduction {
  switch (operation.type) {
    case "drum-hits.add": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as DrumPattern;
      if (operation.hits.length === 0) return { project, changes: emptyChangeSummary() };
      const candidate = replacePattern(project, { ...pattern, events: [...pattern.events, ...operation.hits] });
      return { project: candidate, changes: withChanges({ created: { drumHitIds: operation.hits.map((hit) => hit.id) } }) };
    }
    case "drum-hits.update": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as DrumPattern;
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
      return { project: candidate, changes: withChanges({ updated: { drumHitIds: changedHitIds } }) };
    }
    case "drum-hits.delete": {
      const pattern = project.patterns.find((pattern) => pattern.id === operation.patternId) as DrumPattern;
      if (operation.hitIds.length === 0) return { project, changes: emptyChangeSummary() };
      const hitIds = new Set(operation.hitIds);
      const candidate = replacePattern(project, { ...pattern, events: pattern.events.filter((hit) => !hitIds.has(hit.id)) });
      return { project: candidate, changes: withChanges({ deleted: { drumHitIds: operation.hitIds } }) };
    }
  }
  return unsupportedOperation(operation);
}
