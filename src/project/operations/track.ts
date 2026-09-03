import { emptyChangeSummary, type Reduction } from "../commands.ts";
import type { Project, Track } from "../model.ts";
import { isJsonEqual, unsupportedOperation, withChanges } from "./shared.ts";

export type TrackOperation =
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
  | { readonly type: "track.reorder"; readonly trackId: string; readonly toIndex: number };

export function reduceTrackOperation(project: Project, operation: TrackOperation): Reduction {
  switch (operation.type) {
    case "track.create": {
      const candidate: Project = { ...project, tracks: [...project.tracks, operation.track] };
      return { project: candidate, changes: withChanges({ created: { trackIds: [operation.track.id] } }) };
    }
    case "track.update": {
      const track = project.tracks.find((track) => track.id === operation.trackId)!;
      const updatedTrack: Track = {
        ...track,
        ...(operation.changes.name === undefined ? {} : { name: operation.changes.name }),
        ...(operation.changes.instrumentId === undefined ? {} : { instrumentId: operation.changes.instrumentId }),
        ...(operation.changes.volumeDb === undefined ? {} : { volumeDb: operation.changes.volumeDb }),
        ...(operation.changes.pan === undefined ? {} : { pan: operation.changes.pan }),
        ...(operation.changes.muted === undefined ? {} : { muted: operation.changes.muted }),
        ...(operation.changes.soloed === undefined ? {} : { soloed: operation.changes.soloed }),
      };
      if (isJsonEqual(track, updatedTrack)) return { project, changes: emptyChangeSummary() };
      const candidate: Project = {
        ...project,
        tracks: project.tracks.map((candidateTrack) => candidateTrack.id === track.id ? updatedTrack : candidateTrack),
      };
      return { project: candidate, changes: withChanges({ updated: { trackIds: [track.id] } }) };
    }
    case "track.delete": {
      const deletedClips = project.arrangement.filter((clip) => clip.trackId === operation.trackId);
      const candidate: Project = {
        ...project,
        tracks: project.tracks.filter((track) => track.id !== operation.trackId),
        arrangement: project.arrangement.filter((clip) => clip.trackId !== operation.trackId),
      };
      return {
        project: candidate,
        changes: withChanges({ deleted: {
          trackIds: [operation.trackId],
          arrangementClipIds: deletedClips.map((clip) => clip.id),
        } }),
      };
    }
    case "track.reorder": {
      const fromIndex = project.tracks.findIndex((track) => track.id === operation.trackId);
      if (fromIndex === operation.toIndex) return { project, changes: emptyChangeSummary() };
      const tracks = [...project.tracks];
      const [moved] = tracks.splice(fromIndex, 1);
      tracks.splice(operation.toIndex, 0, moved!);
      const candidate: Project = { ...project, tracks };
      return {
        project: candidate,
        changes: withChanges({ updated: { projectIds: [project.id] } }),
      };
    }
  }
  return unsupportedOperation(operation);
}
