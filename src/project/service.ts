import {
  type ChangeSummary,
  type Command,
  type DispatchFailure,
  type DispatchResult,
  emptyChangeSummary,
  type HistoryAction,
  type HistoryControlResult,
  type HistoryEntry,
  mergeChangeSummaries,
  type Operation,
  type RestoreCommand,
} from "./commands.ts";
import { ConflictError, DomainError, InvalidInputError, LimitExceededError, NotFoundError } from "./errors.ts";
import { assertUuid, PROJECT_CAPS, type Project, type SoundCatalog, validateProject } from "./model.ts";
import { reduceOperation, summarizeProjectDiff } from "./reducer.ts";

export interface ProjectServiceState {
  readonly project: Project;
  readonly history: readonly HistoryEntry[];
  readonly historyCursor: number;
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

const commandIdFor = (command: Command | RestoreCommand): string => {
  const record = requireRecord(command, "command");
  return typeof record.id === "string" && record.id.length > 0
    ? record.id
    : invalidCommand("command.id", "must be a non-empty string");
};

const validateCommandMetadata = (command: unknown): Readonly<Record<string, unknown>> => {
  const record = requireRecord(command, "command");
  if (record.source !== "manual" && record.source !== "agent") {
    invalidCommand("command.source", "must be manual or agent");
  }
  if (typeof record.label !== "string" || record.label.trim().length === 0) {
    invalidCommand("command.label", "must be a non-empty string");
  }
  return record;
};

const validateCommand = (command: Command): void => {
  const record = validateCommandMetadata(command);
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

const cloneJson = <T>(value: unknown, path: string): T => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(structuredClone(value));
  } catch {
    return invalidCommand(path, "must be structured-cloneable and JSON-serializable");
  }
  return serialized === undefined
    ? invalidCommand(path, "must be JSON-serializable")
    : JSON.parse(serialized) as T;
};

const cloneOperation = (operation: unknown, path: string): Operation =>
  cloneJson<Operation>(operation, path);

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

export class ProjectService {
  private project: Project;
  private history: readonly HistoryEntry[] = [];
  private historyCursor = -1;
  private readonly successfulOutcomes = new Map<string, SuccessfulOutcome>();
  private readonly options: ProjectServiceOptions;

  constructor(options: ProjectServiceOptions) {
    const initialProject = cloneJson<Project>(options.initialProject, "initialProject");
    validateProject(initialProject, options.catalog);
    this.options = options;
    this.project = initialProject;
    this.getState = this.getState.bind(this);
    this.dispatch = this.dispatch.bind(this);
    this.undo = this.undo.bind(this);
    this.redo = this.redo.bind(this);
    this.restore = this.restore.bind(this);
  }

  getState(): ProjectServiceState {
    return {
      project: this.project,
      history: this.history,
      historyCursor: this.historyCursor,
    };
  }

  dispatch(command: Command): DispatchResult {
    try {
      const commandId = commandIdFor(command);
      const existing = this.successfulOutcomes.get(commandId);
      if (existing !== undefined) {
        return {
          ok: true,
          deduplicated: true,
          project: this.project,
          ...existing,
        };
      }

      assertUuid(commandId, "command.id");
      validateCommand(command);
      const operations = operationsFor(command);
      let nextProject = this.project;
      const changeSummaries: ChangeSummary[] = [];
      const historyOperations: Operation[] = [];
      for (const [batchIndex, operation] of operations.entries()) {
        try {
          const path = command.kind === "batch" ? `command.operations[${batchIndex}]` : "command.operation";
          validateOperation(operation, path);
          const historyOperation = cloneOperation(operation, path);
          const reduction = reduceOperation(nextProject, historyOperation, this.options.catalog);
          nextProject = reduction.project;
          changeSummaries.push(reduction.changes);
          historyOperations.push(historyOperation);
        } catch (error: unknown) {
          if (error instanceof DomainError) {
            return command.kind === "batch"
              ? failureAtBatchIndex(this.project, error, batchIndex)
              : failure(this.project, error);
          }
          throw error;
        }
      }

      const changes = mergeChangeSummaries(changeSummaries);
      const changed = nextProject !== this.project;
      let historyEntry: HistoryEntry | undefined;
      if (changed) {
        historyEntry = this.commit(
          commandId,
          command.source,
          command.label,
          actionFor(command.kind, historyOperations),
          nextProject,
          changes,
        );
      }

      const outcome: SuccessfulOutcome = {
        changed,
        ...(historyEntry === undefined ? {} : { historyEntry }),
        changes,
      };
      this.remember(commandId, outcome);
      return { ok: true, deduplicated: false, project: this.project, ...outcome };
    } catch (error: unknown) {
      if (error instanceof DomainError) return failure(this.project, error);
      throw error;
    }
  }

  undo(): HistoryControlResult {
    const entry = this.history[this.historyCursor];
    if (entry === undefined) return { ok: false, reason: "nothing_to_undo", project: this.project };
    this.project = entry.before;
    this.historyCursor -= 1;
    return { ok: true, project: this.project };
  }

  redo(): HistoryControlResult {
    const entry = this.history[this.historyCursor + 1];
    if (entry === undefined) return { ok: false, reason: "nothing_to_redo", project: this.project };
    this.project = entry.after;
    this.historyCursor += 1;
    return { ok: true, project: this.project };
  }

  restore(command: RestoreCommand): DispatchResult {
    try {
      const commandId = commandIdFor(command);
      const existing = this.successfulOutcomes.get(commandId);
      if (existing !== undefined) {
        return { ok: true, deduplicated: true, project: this.project, ...existing };
      }

      assertUuid(commandId, "command.id");
      const record = validateCommandMetadata(command);
      const targetEntryId = typeof record.targetEntryId === "string"
        && record.targetEntryId.length > 0
        ? record.targetEntryId
        : invalidCommand("command.targetEntryId", "must be a non-empty string");
      assertUuid(targetEntryId, "command.targetEntryId");
      const target = this.history.find((entry) => entry.id === targetEntryId);
      if (target === undefined) {
        throw new NotFoundError({
          path: "command.targetEntryId",
          message: "must reference a retained history entry",
        });
      }
      validateProject(target.after, this.options.catalog);

      const changed = JSON.stringify(target.after) !== JSON.stringify(this.project);
      const changes = changed ? summarizeProjectDiff(this.project, target.after) : emptyChangeSummary();
      const historyEntry = changed
        ? this.commit(
          commandId,
          command.source,
          command.label,
          { kind: "restore", targetEntryId: target.id },
          target.after,
          changes,
        )
        : undefined;
      const outcome: SuccessfulOutcome = {
        changed,
        ...(historyEntry === undefined ? {} : { historyEntry }),
        changes,
      };
      this.remember(commandId, outcome);
      return { ok: true, deduplicated: false, project: this.project, ...outcome };
    } catch (error: unknown) {
      if (error instanceof DomainError) return failure(this.project, error);
      throw error;
    }
  }

  private remember(commandId: string, outcome: SuccessfulOutcome): void {
    if (this.successfulOutcomes.size >= PROJECT_CAPS.maxSuccessfulCommands) {
      this.successfulOutcomes.delete(this.successfulOutcomes.keys().next().value!);
    }
    this.successfulOutcomes.set(commandId, outcome);
  }

  private commit(
    commandId: string,
    source: HistoryEntry["source"],
    label: string,
    action: HistoryAction,
    nextProject: Project,
    changes: ChangeSummary,
  ): HistoryEntry {
    const historyId = this.options.createHistoryId();
    assertUuid(historyId, "historyEntry.id");
    if (this.history.some((entry) => entry.id === historyId)) {
      throw new ConflictError({
        path: "historyEntry.id",
        message: "must be unique among retained history entries",
        relatedIds: [historyId],
      });
    }
    const createdAt = this.options.now();
    if (!Number.isInteger(createdAt) || createdAt < 0) {
      invalidCommand("historyEntry.createdAt", "must be a finite non-negative integer");
    }
    const historyEntry: HistoryEntry = {
      id: historyId,
      commandId,
      source,
      label,
      createdAt,
      action,
      before: this.project,
      after: nextProject,
      changes,
    };
    this.history = [...this.history.slice(0, this.historyCursor + 1), historyEntry]
      .slice(-PROJECT_CAPS.maxHistoryEntries);
    this.historyCursor = this.history.length - 1;
    this.project = nextProject;
    return historyEntry;
  }
}
