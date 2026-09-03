import { emptyChangeSummary, type ChangeSummary } from "../commands.ts";
import type { Pattern, Project } from "../model.ts";

export const isJsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const withChanges = (
  changes: Partial<{
    readonly created: Partial<ChangeSummary["created"]>;
    readonly updated: Partial<ChangeSummary["updated"]>;
    readonly deleted: Partial<ChangeSummary["deleted"]>;
  }>,
): ChangeSummary => {
  const empty = emptyChangeSummary();
  return {
    created: { ...empty.created, ...changes.created },
    updated: { ...empty.updated, ...changes.updated },
    deleted: { ...empty.deleted, ...changes.deleted },
  };
};

export const replacePattern = (project: Project, updatedPattern: Pattern): Project => ({
  ...project,
  patterns: project.patterns.map((pattern) =>
    pattern.id === updatedPattern.id ? updatedPattern : pattern),
});

export const unsupportedOperation = (operation: never): never => {
  const type = (operation as { readonly type?: unknown }).type;
  throw new Error(`Unsupported project operation: ${String(type)}`);
};
