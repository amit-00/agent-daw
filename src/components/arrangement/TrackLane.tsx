"use client";

import type { ReactElement } from "react";

import { Clip } from "@/components/arrangement/Clip";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function TrackLane({ track, row, bars }: Readonly<{ track: Track; row: number; bars: number }>): ReactElement {
  const project = useStudioStore((state) => state.project);
  return (
    <section className="relative col-start-2 min-w-0 border-b border-white/10 bg-transparent"
      aria-label={`${track.name} lane`} style={{ gridRow: row }}>
      {project.arrangement.filter((clip) => clip.trackId === track.id).map((clip) => {
        const pattern = project.patterns.find((item) => item.id === clip.patternId);
        return pattern ? <Clip key={clip.id} clip={clip} pattern={pattern} bars={bars} /> : null;
      })}
    </section>
  );
}
