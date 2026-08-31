"use client";

import { useId, type ReactElement } from "react";

import { getTrackColor } from "@/data/studio-data";
import type { ArrangementClip, Pattern } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

export function Clip({ clip, pattern, bars }: Readonly<{ clip: ArrangementClip; pattern: Pattern; bars: number }>): ReactElement {
  const selected = useStudioStore((state) => state.selectedClipId === clip.id);
  const selectClip = useStudioStore((state) => state.selectClip);
  const marksId = useId();
  const steps = pattern.lengthBars * 16;
  return (
    <button type="button" aria-label={`Select ${pattern.name}`} aria-pressed={selected} onClick={() => selectClip(clip.id)}
      className="absolute inset-y-0 overflow-hidden rounded-[3px] border text-left text-zinc-950 hover:brightness-110"
      style={{ left: `${clip.startBar / bars * 100}%`, width: `calc(${pattern.lengthBars * clip.repeatCount / bars * 100}% - 2px)`,
        background: getTrackColor(clip.trackId), borderColor: selected ? "white" : "transparent" }}>
      <span className="absolute inset-x-2 top-2 truncate text-[10px] font-semibold">{pattern.name} · ×{clip.repeatCount}</span>
      <svg className="absolute inset-x-2 bottom-2 h-16 w-[calc(100%-16px)] opacity-50" aria-hidden="true" viewBox={`0 0 ${steps * clip.repeatCount} 73`} preserveAspectRatio="none">
        <defs>
          <pattern id={marksId} width={steps} height={73} patternUnits="userSpaceOnUse">
            {pattern.kind === "drum"
              ? pattern.events.map((hit) => <rect key={hit.id} x={hit.startStep} y={hit.soundId === "kick" ? 52 : hit.soundId === "snare" ? 30 : 8} width={0.65} height={14} fill="currentColor" />)
              : pattern.events.map((note) => <rect key={note.id} x={note.startStep} y={96 - note.midiNote} width={note.lengthSteps} height={2} fill="currentColor" />)}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${marksId})`} />
      </svg>
    </button>
  );
}
