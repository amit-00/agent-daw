import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { ArrangementClip, Project } from "../model.ts";
import { isJsonEqual, unsupportedOperation, withChanges } from "./shared.ts";

export type ArrangementOperation =
  | { readonly type: "arrangement.place"; readonly clip: ArrangementClip }
  | {
      readonly type: "arrangement.update";
      readonly clipId: string;
      readonly changes: {
        readonly patternId?: string;
        readonly trackId?: string;
        readonly startBar?: number;
        readonly repeatCount?: number;
      };
    }
  | { readonly type: "arrangement.delete"; readonly clipId: string };

export function reduceArrangementOperation(
  project: Project,
  operation: ArrangementOperation,
): Reduction {
  switch (operation.type) {
    case "arrangement.place": {
      const clip: ArrangementClip = {
        id: operation.clip.id,
        patternId: operation.clip.patternId,
        trackId: operation.clip.trackId,
        startBar: operation.clip.startBar,
        repeatCount: operation.clip.repeatCount,
      };
      const candidate: Project = { ...project, arrangement: [...project.arrangement, clip] };
      return { project: candidate, changes: withChanges({ created: { arrangementClipIds: [clip.id] } }) };
    }
    case "arrangement.update": {
      const clip = project.arrangement.find((clip) => clip.id === operation.clipId)!;
      const updatedClip: ArrangementClip = {
        ...clip,
        ...(operation.changes.patternId === undefined ? {} : { patternId: operation.changes.patternId }),
        ...(operation.changes.trackId === undefined ? {} : { trackId: operation.changes.trackId }),
        ...(operation.changes.startBar === undefined ? {} : { startBar: operation.changes.startBar }),
        ...(operation.changes.repeatCount === undefined ? {} : { repeatCount: operation.changes.repeatCount }),
      };
      if (isJsonEqual(clip, updatedClip)) return { project, changes: emptyChangeSummary() };
      const candidate: Project = {
        ...project,
        arrangement: project.arrangement.map((candidateClip) => candidateClip.id === clip.id ? updatedClip : candidateClip),
      };
      return { project: candidate, changes: withChanges({ updated: { arrangementClipIds: [clip.id] } }) };
    }
    case "arrangement.delete": {
      const clip = project.arrangement.find((clip) => clip.id === operation.clipId)!;
      const candidate: Project = {
        ...project,
        arrangement: project.arrangement.filter((candidateClip) => candidateClip.id !== clip.id),
      };
      return { project: candidate, changes: withChanges({ deleted: { arrangementClipIds: [clip.id] } }) };
    }
  }
  return unsupportedOperation(operation);
}
