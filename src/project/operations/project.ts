import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { Project } from "../model.ts";
import { isJsonEqual, unsupportedOperation, withChanges } from "./shared.ts";

export type ProjectOperation = {
  readonly type: "project.update";
  readonly changes: {
    readonly name?: string;
    readonly bpm?: number;
    readonly masterVolumeDb?: number;
  };
};

type ProjectReducerOperation = ProjectOperation | { readonly type: never };

export function reduceProjectOperation(
  project: Project,
  operation: ProjectReducerOperation,
): Reduction {
  switch (operation.type) {
    case "project.update": {
      const candidate: Project = {
        ...project,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.bpm === undefined ? {} : { bpm: operation.changes.bpm }),
        ...(operation.changes.masterVolumeDb === undefined
          ? {}
          : { masterVolumeDb: operation.changes.masterVolumeDb }),
      };
      if (isJsonEqual(project, candidate)) {
        return { project, changes: emptyChangeSummary() };
      }
      return {
        project: candidate,
        changes: withChanges({ updated: { projectIds: [project.id] } }),
      };
    }
    default: {
      const unreachable: never = operation;
      return unsupportedOperation(unreachable);
    }
  }
}
