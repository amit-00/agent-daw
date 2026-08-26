import {
  type ChangeSummary,
  type Command,
  type DispatchFailure,
  type DispatchResult,
  type HistoryAction,
  type HistoryEntry,
  mergeChangeSummaries,
  type Operation,
} from "./commands.ts";
import { DomainError, InvalidInputError, LimitExceededError } from "./errors.ts";
import { PROJECT_CAPS, type Project, type SoundCatalog } from "./model.ts";
import { reduceOperation } from "./reducer.ts";

export interface ProjectServiceState {
  readonly project: Project;
  readonly history: readonly HistoryEntry[];
  readonly historyCursor: number;
}

export interface ProjectService {
  getState(): ProjectServiceState;
  dispatch(command: Command): DispatchResult;
}

export interface ProjectServiceOptions {
  readonly initialProject: Project;
  readonly catalog: SoundCatalog;
  readonly createHistoryId: () => string;
  readonly now: () => number;
}

interface SuccessfulOutcome {
  readonly changed: boolean;
  readonly historyEntry?: HistoryEntry;
  readonly changes: ChangeSummary;
}

const invalidCommand = (path: string, message: string): never => {
  throw new InvalidInputError({ path, message });
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, path: string): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : invalidCommand(path, "must be an object");

const requireArray = (value: unknown, path: string): readonly unknown[] =>
  Array.isArray(value) ? value : invalidCommand(path, "must be an array");

const requireRecords = (value: unknown, path: string): void => {
  requireArray(value, path).forEach((entry: unknown, index: number) => requireRecord(entry, `${path}[${index}]`));
};

const requireUpdates = (value: unknown, path: string): void => {
  requireArray(value, path).forEach((entry: unknown, index: number) => {
    const update = requireRecord(entry, `${path}[${index}]`);
    requireRecord(update.changes, `${path}[${index}].changes`);
  });
};

const operationTypes: ReadonlySet<Operation["type"]> = new Set([
  "project.update",
  "track.create", "track.update", "track.delete",
  "pattern.create", "pattern.duplicate", "pattern.update", "pattern.delete",
  "arrangement.place", "arrangement.update", "arrangement.delete",
  "drum-hits.add", "drum-hits.update", "drum-hits.delete",
  "synth-notes.add", "synth-notes.update", "synth-notes.delete",
]);

const validateOperation = (operation: unknown, path: string): void => {
  const record = requireRecord(operation, path);
  if (typeof record.type !== "string" || !operationTypes.has(record.type as Operation["type"])) {
    invalidCommand(path, "must be a supported operation");
  }
  switch (record.type) {
    case "project.update":
      requireRecord(record.changes, `${path}.changes`);
      return;
    case "track.create":
      requireRecord(record.track, `${path}.track`);
      return;
    case "track.update":
      requireRecord(record.changes, `${path}.changes`);
      return;
    case "pattern.create":
      requireRecord(record.pattern, `${path}.pattern`);
      return;
    case "pattern.duplicate":
      requireArray(record.duplicateEventIds, `${path}.duplicateEventIds`);
      return;
    case "pattern.update":
      requireRecord(record.changes, `${path}.changes`);
      return;
    case "arrangement.place":
      requireRecord(record.clip, `${path}.clip`);
      return;
    case "arrangement.update":
      requireRecord(record.changes, `${path}.changes`);
      return;
    case "drum-hits.add":
      requireRecords(record.hits, `${path}.hits`);
      return;
    case "drum-hits.update":
      requireUpdates(record.updates, `${path}.updates`);
      return;
    case "drum-hits.delete":
      requireArray(record.hitIds, `${path}.hitIds`);
      return;
    case "synth-notes.add":
      requireRecords(record.notes, `${path}.notes`);
      return;
    case "synth-notes.update":
      requireUpdates(record.updates, `${path}.updates`);
      return;
    case "synth-notes.delete":
      requireArray(record.noteIds, `${path}.noteIds`);
      return;
    case "track.delete":
    case "pattern.delete":
      return;
  }
};

const commandIdFor = (command: Command): string => {
  const record = requireRecord(command, "command");
  return typeof record.id === "string" && record.id.length > 0
    ? record.id
    : invalidCommand("command.id", "must be a non-empty string");
};

const validateCommand = (command: Command): void => {
  const record = requireRecord(command, "command");
  if (record.source !== "manual" && record.source !== "agent") {
    invalidCommand("command.source", "must be manual or agent");
  }
  if (typeof record.label !== "string" || record.label.trim().length === 0) {
    invalidCommand("command.label", "must be a non-empty string");
  }
  if (record.kind === "operation") {
    return;
  }
  if (record.kind === "batch") {
    requireArray(record.operations, "command.operations");
    return;
  }
  invalidCommand("command.kind", "must be operation or batch");
};

const operationsFor = (command: Command): readonly Operation[] => {
  if (command.kind === "operation") return [command.operation];
  if (command.operations.length === 0) {
    invalidCommand("command.operations", "must contain at least one operation");
  }
  if (command.operations.length > PROJECT_CAPS.maxOperationsPerBatch) {
    throw new LimitExceededError({
      path: "command.operations",
      message: `must contain at most ${PROJECT_CAPS.maxOperationsPerBatch} operations`,
    });
  }
  return command.operations;
};

const cloneOperation = (operation: unknown, path: string): Operation => {
  try {
    const clone = structuredClone(operation);
    const serialized = JSON.stringify(clone);
    return serialized === undefined
      ? invalidCommand(path, "must be JSON-serializable")
      : JSON.parse(serialized) as Operation;
  } catch {
    return invalidCommand(path, "must be structured-cloneable and JSON-serializable");
  }
};

const actionFor = (kind: Command["kind"], operations: readonly Operation[]): HistoryAction => kind === "operation"
  ? { kind: "operation", operation: operations[0]! }
  : { kind: "batch", operations };

const failure = (project: Project, error: DomainError): DispatchFailure => ({
  ok: false,
  project,
  error: error.info,
});

const failureAtBatchIndex = (project: Project, error: DomainError, batchIndex: number): DispatchFailure => ({
  ok: false,
  project,
  error: { ...error.info, batchIndex },
});

export function createProjectService(options: ProjectServiceOptions): ProjectService {
  let project = options.initialProject;
  let history: readonly HistoryEntry[] = [];
  let historyCursor = -1;
  const successfulOutcomes = new Map<string, SuccessfulOutcome>();

  const remember = (commandId: string, outcome: SuccessfulOutcome): void => {
    if (successfulOutcomes.size >= PROJECT_CAPS.maxSuccessfulCommands) {
      successfulOutcomes.delete(successfulOutcomes.keys().next().value!);
    }
    successfulOutcomes.set(commandId, outcome);
  };

  return {
    getState: (): ProjectServiceState => ({ project, history, historyCursor }),
    dispatch: (command: Command): DispatchResult => {
      try {
        const commandId = commandIdFor(command);
        const existing = successfulOutcomes.get(commandId);
        if (existing !== undefined) {
          return {
            ok: true,
            deduplicated: true,
            project,
            ...existing,
          };
        }

        validateCommand(command);
        const operations = operationsFor(command);
        let nextProject = project;
        const changeSummaries: ChangeSummary[] = [];
        const historyOperations: Operation[] = [];
        for (const [batchIndex, operation] of operations.entries()) {
          try {
            const path = command.kind === "batch" ? `command.operations[${batchIndex}]` : "command.operation";
            validateOperation(operation, path);
            const historyOperation = cloneOperation(operation, path);
            const reduction = reduceOperation(nextProject, operation, options.catalog);
            nextProject = reduction.project;
            changeSummaries.push(reduction.changes);
            historyOperations.push(historyOperation);
          } catch (error: unknown) {
            if (error instanceof DomainError) {
              return command.kind === "batch"
                ? failureAtBatchIndex(project, error, batchIndex)
                : failure(project, error);
            }
            throw error;
          }
        }

        const changes = mergeChangeSummaries(changeSummaries);
        const changed = nextProject !== project;
        let historyEntry: HistoryEntry | undefined;
        if (changed) {
          historyEntry = {
            id: options.createHistoryId(),
            commandId,
            source: command.source,
            label: command.label,
            createdAt: options.now(),
            action: actionFor(command.kind, historyOperations),
            before: project,
            after: nextProject,
            changes,
          };
          const nextHistory = [...history.slice(0, historyCursor + 1), historyEntry];
          history = nextHistory.slice(-PROJECT_CAPS.maxHistoryEntries);
          historyCursor = history.length - 1;
          project = nextProject;
        }

        const outcome: SuccessfulOutcome = {
          changed,
          ...(historyEntry === undefined ? {} : { historyEntry }),
          changes,
        };
        remember(commandId, outcome);
        return { ok: true, deduplicated: false, project, ...outcome };
      } catch (error: unknown) {
        if (error instanceof DomainError) return failure(project, error);
        throw error;
      }
    },
  };
}
