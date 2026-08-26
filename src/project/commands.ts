import type { Project, Track } from "./model.ts";

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
  | { readonly type: "track.delete"; readonly trackId: string };

export interface Reduction {
  readonly project: Project;
  readonly changes: ChangeSummary;
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
