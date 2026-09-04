import type { ArrangementOperation } from "./operations/arrangement.ts";
import type { DrumHitOperation } from "./operations/drum-hits.ts";
import type { PatternOperation } from "./operations/pattern.ts";
import type { ProjectOperation } from "./operations/project.ts";
import type { SynthNoteOperation } from "./operations/synth-notes.ts";
import type { TrackOperation } from "./operations/track.ts";
import type { Project } from "./model.ts";

export type { ArrangementOperation } from "./operations/arrangement.ts";
export type { DrumHitOperation } from "./operations/drum-hits.ts";
export type { PatternOperation } from "./operations/pattern.ts";
export type { ProjectOperation } from "./operations/project.ts";
export type { SynthNoteOperation } from "./operations/synth-notes.ts";
export type { TrackOperation } from "./operations/track.ts";

export interface EntityIds {
  readonly projectIds: readonly string[];
  readonly trackIds: readonly string[];
  readonly patternIds: readonly string[];
  readonly drumHitIds: readonly string[];
  readonly synthNoteIds: readonly string[];
  readonly arrangementClipIds: readonly string[];
}

export interface ChangeSummary {
  readonly created: EntityIds;
  readonly updated: EntityIds;
  readonly deleted: EntityIds;
}

export type Operation =
  | ProjectOperation
  | TrackOperation
  | PatternOperation
  | ArrangementOperation
  | DrumHitOperation
  | SynthNoteOperation;

export interface Reduction {
  readonly project: Project;
  readonly changes: ChangeSummary;
}

export type CommandSource = "manual" | "agent";

interface CommandMetadata {
  readonly id: string;
  readonly source: CommandSource;
  readonly label: string;
  readonly toolName?: string;
}

export type Command = CommandMetadata & (
  | { readonly kind: "operation"; readonly operation: Operation }
  | { readonly kind: "batch"; readonly operations: readonly Operation[] }
);

export type HistoryAction =
  | { readonly kind: "operation"; readonly operation: Operation }
  | { readonly kind: "batch"; readonly operations: readonly Operation[] }
  | { readonly kind: "restore"; readonly targetEntryId: string };

export interface HistoryEntry {
  readonly id: string;
  readonly commandId: string;
  readonly source: CommandSource;
  readonly label: string;
  readonly toolName?: string;
  readonly createdAt: number;
  readonly action: HistoryAction;
  readonly before: Project;
  readonly after: Project;
  readonly changes: ChangeSummary;
}

export interface DispatchResult {
  readonly ok: true;
  readonly changed: boolean;
  readonly deduplicated: boolean;
  readonly project: Project;
  readonly historyEntry?: HistoryEntry;
  readonly changes: ChangeSummary;
}

export interface HistoryControlCommand {
  readonly id: string;
  readonly kind: "undo" | "redo";
}

export interface HistoryControlSuccess {
  readonly ok: true;
  readonly changed: true;
  readonly deduplicated: boolean;
  readonly project: Project;
  readonly changes: ChangeSummary;
}

export interface HistoryControlUnavailable {
  readonly ok: false;
  readonly reason: "nothing_to_undo" | "nothing_to_redo";
  readonly project: Project;
}

export type HistoryControlResult =
  | HistoryControlSuccess
  | HistoryControlUnavailable;

export interface RestoreCommand {
  readonly id: string;
  readonly source: CommandSource;
  readonly label: string;
  readonly toolName?: string;
  readonly targetEntryId: string;
}

const emptyEntityIds = (): EntityIds => ({
  projectIds: [], trackIds: [], patternIds: [], drumHitIds: [], synthNoteIds: [], arrangementClipIds: [],
});

export const emptyChangeSummary = (): ChangeSummary => ({
  created: emptyEntityIds(), updated: emptyEntityIds(), deleted: emptyEntityIds(),
});

const mergeEntityIds = (entities: readonly EntityIds[]): EntityIds => {
  const unique = (select: (entity: EntityIds) => readonly string[]): readonly string[] => [
    ...new Set(entities.flatMap(select)),
  ];
  return {
    projectIds: unique((entity) => entity.projectIds),
    trackIds: unique((entity) => entity.trackIds),
    patternIds: unique((entity) => entity.patternIds),
    drumHitIds: unique((entity) => entity.drumHitIds),
    synthNoteIds: unique((entity) => entity.synthNoteIds),
    arrangementClipIds: unique((entity) => entity.arrangementClipIds),
  };
};

export const mergeChangeSummaries = (summaries: readonly ChangeSummary[]): ChangeSummary => ({
  created: mergeEntityIds(summaries.map((summary) => summary.created)),
  updated: mergeEntityIds(summaries.map((summary) => summary.updated)),
  deleted: mergeEntityIds(summaries.map((summary) => summary.deleted)),
});
