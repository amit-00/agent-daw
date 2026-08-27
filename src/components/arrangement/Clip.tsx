"use client";

import type { CSSProperties, ReactElement } from "react";

import { DRUM_LEVELS, NOTE_MARKS } from "@/data/studio-data";
import { useStudioStore } from "@/stores/studio-store";
import type { Clip as ClipData, Track } from "@/types/studio";

function ClipMarks({ kind }: Readonly<{ kind: Track["kind"] }>): ReactElement {
  if (kind === "drum") {
    return (
      <span className="absolute right-1.5 bottom-[11px] left-1.5 flex h-[45px] items-center gap-0.5 opacity-50" aria-hidden="true">
        {DRUM_LEVELS.map((height, index) => (
          <i className="min-w-px flex-1 rounded-px bg-[rgba(48,22,27,0.82)]" key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </span>
    );
  }

  return (
    <span className="absolute inset-x-[7px] top-6 bottom-1.5 opacity-[0.58]" aria-hidden="true">
      {NOTE_MARKS.map(([left, top, width]) => (
        <i className="absolute h-0.5 rounded-full bg-[rgba(35,17,48,0.82)]" key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%` }} />
      ))}
    </span>
  );
}

export function Clip({ clip, track }: Readonly<{ clip: ClipData; track: Track }>): ReactElement {
  const selected = useStudioStore((state) => state.selectedClipId === clip.id);
  const selectClip = useStudioStore((state) => state.selectClip);
  const style: CSSProperties = {
    left: `${clip.start}%`,
    width: `calc(${clip.width}% - 2px)`,
    borderColor: selected ? "rgba(255, 255, 255, 0.85)" : `color-mix(in srgb, ${track.color}, #fff 8%)`,
    background: `color-mix(in srgb, color-mix(in srgb, ${track.color} 88%, white) 80%, transparent)`,
  };

  return (
    <button className="absolute top-0 h-full cursor-pointer overflow-hidden rounded-[3px] border p-0 text-left text-[rgba(20,12,24,0.72)] transition-[filter,transform] duration-150 hover:-translate-y-px hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300" type="button" aria-label={`Select ${clip.name}`} aria-pressed={selected} onClick={() => selectClip(clip.id)} style={style}>
      <span className="absolute top-[7px] right-2 left-2 z-[1] block overflow-hidden text-[9px] font-bold tracking-[0.055em] text-ellipsis whitespace-nowrap uppercase">{clip.name}</span>
      <ClipMarks kind={track.kind} />
    </button>
  );
}
