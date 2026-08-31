import type { ArrangementClip, DrumHit, Pattern, PatternLengthBars, Project, SynthNote, Track } from "./model.ts";

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
  | { readonly type: "project.update"; readonly changes: { readonly name?: string; readonly bpm?: number; readonly masterVolumeDb?: number } }
  | { readonly type: "track.create"; readonly track: Track }
  | {
      readonly type: "track.update";
      readonly trackId: string;
      readonly changes: {
        readonly name?: string;
        readonly instrumentId?: string;
        readonly volumeDb?: number;
        readonly pan?: number;
        readonly muted?: boolean;
        readonly soloed?: boolean;
      };
    }
  | { readonly type: "track.delete"; readonly trackId: string }
  | { readonly type: "track.reorder"; readonly trackId: string; readonly toIndex: number }
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
  | { readonly type: "pattern.delete"; readonly patternId: string }
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
  | { readonly type: "arrangement.delete"; readonly clipId: string }
  | { readonly type: "drum-hits.add"; readonly patternId: string; readonly hits: readonly DrumHit[] }
  | {
      readonly type: "drum-hits.update";
      readonly patternId: string;
      readonly updates: readonly {
        readonly hitId: string;
        readonly changes: { readonly soundId?: string; readonly startStep?: number };
      }[];
    }
  | { readonly type: "drum-hits.delete"; readonly patternId: string; readonly hitIds: readonly string[] }
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

export interface Reduction {
  readonly project: Project;
  readonly changes: ChangeSummary;
}

export type CommandSource = "manual" | "agent";

interface CommandMetadata {
  readonly id: string;
  readonly source: CommandSource;
  readonly label: string;
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

export interface HistoryControlSuccess {
  readonly ok: true;
  readonly project: Project;
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
