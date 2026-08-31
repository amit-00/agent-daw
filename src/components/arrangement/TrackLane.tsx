"use client";

import type { ReactElement } from "react";

import { Clip } from "@/components/arrangement/Clip";
import type { Track } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function TrackLane({ track, row, bars, onEditClip }: Readonly<{
  track: Track; row: number; bars: number; onEditClip: (clipId: string) => void;
}>): ReactElement {
  const project = useStudioStore((state) => state.project);
  const createPatternAt = useStudioStore((state) => state.createPatternAt);
  return (
    <section data-track-id={track.id} tabIndex={-1} className="relative col-start-2 min-w-0 border-b border-white/10 bg-transparent"
      aria-label={`${track.name} lane`} style={{ gridRow: row }} title="Double-click an empty bar to create a pattern. Track settings also offer Create pattern here."
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        createPatternAt(track.id, Math.floor((event.clientX - rect.left) / rect.width * bars));
      }}>
      {project.arrangement.filter((clip) => clip.trackId === track.id).map((clip) => {
        const pattern = project.patterns.find((item) => item.id === clip.patternId);
        return pattern ? <Clip key={clip.id} clip={clip} pattern={pattern} bars={bars} onEdit={() => onEditClip(clip.id)} /> : null;
      })}
    </section>
  );
}
