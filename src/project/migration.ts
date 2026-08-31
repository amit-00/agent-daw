import type { ArrangementClip, Pattern, Project } from "./model.ts";

export interface ProjectV1 extends Omit<Project, "schemaVersion" | "patterns" | "arrangement"> {
  readonly schemaVersion: 1;
  readonly patterns: readonly (Pattern & { readonly trackId: string })[];
  readonly arrangement: readonly Omit<ArrangementClip, "trackId">[];
}

export function migrateProject(project: ProjectV1 | Project): Project {
  if (project.schemaVersion === 2) return project;
  return {
    ...project,
    schemaVersion: 2,
    patterns: project.patterns.map((pattern): Pattern => pattern.kind === "drum"
      ? { id: pattern.id, name: pattern.name, kind: "drum",
          lengthBars: pattern.lengthBars, events: pattern.events }
      : { id: pattern.id, name: pattern.name, kind: "synth",
          lengthBars: pattern.lengthBars, events: pattern.events }),
    arrangement: project.arrangement.map((clip): ArrangementClip => {
      const pattern = project.patterns.find((candidate) => candidate.id === clip.patternId);
      if (pattern === undefined) {
        throw new RangeError(`Cannot migrate clip ${clip.id}: pattern ${clip.patternId} is missing`);
      }
      return { ...clip, trackId: pattern.trackId };
    }),
  };
}
