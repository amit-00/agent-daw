import {
  type ChangeSummary,
  type Command,
  type DispatchResult,
  emptyChangeSummary,
  type HistoryAction,
  type HistoryControlResult,
  type HistoryEntry,
  mergeChangeSummaries,
  type Operation,
  type RestoreCommand,
} from "./commands.ts";
import { PROJECT_CAPS, type Project } from "./model.ts";
import { reduceOperation, summarizeProjectDiff } from "./reducer.ts";

export interface ProjectServiceState {
  readonly project: Project;
  readonly history: readonly HistoryEntry[];
  readonly historyCursor: number;
}

export interface ProjectServiceOptions {
  readonly initialProject: Project;
  readonly createHistoryId: () => string;
  readonly now: () => number;
}

interface SuccessfulOutcome {
  readonly changed: boolean;
  readonly historyEntry?: HistoryEntry;
  readonly changes: ChangeSummary;
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const actionFor = (kind: Command["kind"], operations: readonly Operation[]): HistoryAction => kind === "operation"
  ? { kind: "operation", operation: operations[0]! }
  : { kind: "batch", operations };

export class ProjectService {
  private project: Project;
  private history: readonly HistoryEntry[] = [];
  private historyCursor = -1;
  private readonly successfulOutcomes = new Map<string, SuccessfulOutcome>();
  private readonly options: ProjectServiceOptions;

  constructor(options: ProjectServiceOptions) {
    this.options = options;
    this.project = cloneJson(options.initialProject);
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
    const existing = this.successfulOutcomes.get(command.id);
    if (existing !== undefined) {
      return { ok: true, deduplicated: true, project: this.project, ...existing };
    }

    const operations = command.kind === "operation" ? [command.operation] : command.operations;
    let nextProject = this.project;
    const changeSummaries: ChangeSummary[] = [];
    const historyOperations: Operation[] = [];
    for (const operation of operations) {
      const historyOperation = cloneJson(operation);
      const reduction = reduceOperation(nextProject, historyOperation);
      nextProject = reduction.project;
      changeSummaries.push(reduction.changes);
      historyOperations.push(historyOperation);
    }

    const changes = mergeChangeSummaries(changeSummaries);
    const changed = nextProject !== this.project;
    const historyEntry = changed
      ? this.commit(
        command.id,
        command.source,
        command.label,
        actionFor(command.kind, historyOperations),
        nextProject,
        changes,
      )
      : undefined;
    const outcome: SuccessfulOutcome = {
      changed,
      ...(historyEntry === undefined ? {} : { historyEntry }),
      changes,
    };
    this.remember(command.id, outcome);
    return { ok: true, deduplicated: false, project: this.project, ...outcome };
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
    const existing = this.successfulOutcomes.get(command.id);
    if (existing !== undefined) {
      return { ok: true, deduplicated: true, project: this.project, ...existing };
    }

    const target = this.history.find((entry) => entry.id === command.targetEntryId)!;
    const changed = JSON.stringify(target.after) !== JSON.stringify(this.project);
    const changes = changed ? summarizeProjectDiff(this.project, target.after) : emptyChangeSummary();
    const historyEntry = changed
      ? this.commit(
        command.id,
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
    this.remember(command.id, outcome);
    return { ok: true, deduplicated: false, project: this.project, ...outcome };
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
    const historyEntry: HistoryEntry = {
      id: this.options.createHistoryId(),
      commandId,
      source,
      label,
      createdAt: this.options.now(),
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
