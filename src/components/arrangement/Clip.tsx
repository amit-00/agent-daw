"use client";

import { useId, type ReactElement } from "react";

import { getTrackColor } from "@/data/studio-data";
import type { ArrangementClip, Pattern } from "@/project";
import { useStudioStore } from "@/stores/studio-provider";

const MIDI_NOTE_HEIGHT = 0.6;

export function Clip({ clip, pattern, bars, onEdit }: Readonly<{
  clip: ArrangementClip; pattern: Pattern; bars: number; onEdit: () => void;
}>): ReactElement {
  const selected = useStudioStore((state) => state.selectedClipId === clip.id);
  const selectClip = useStudioStore((state) => state.selectClip);
  const track = useStudioStore((state) => state.project.tracks.find((item) => item.id === clip.trackId)!);
  const marksId = useId();
  const steps = pattern.lengthBars * 16;
  const color = getTrackColor(track);
  const midiNotes = pattern.kind === "synth" ? pattern.events.map((note) => note.midiNote) : [];
  const octaveStart = midiNotes.length > 0 ? Math.floor(Math.min(...midiNotes) / 12) * 12 : 24;
  const octaveEnd = midiNotes.length > 0 ? (Math.floor(Math.max(...midiNotes) / 12) + 1) * 12 : 97;
  const previewHeight = octaveEnd - octaveStart;
  return (
    <>
    <button type="button" data-clip-id={clip.id} aria-label={`Select ${pattern.name}`} aria-pressed={selected} onClick={() => selectClip(clip.id)}
      onContextMenu={(event) => { event.preventDefault(); selectClip(clip.id); onEdit(); }}
      className="absolute top-0 h-full touch-none cursor-grab overflow-hidden rounded-[3px] border p-0 text-left text-[rgba(20,12,24,0.72)] transition-[filter,transform] duration-150 hover:-translate-y-px hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
      style={{ left: `${clip.startBar / bars * 100}%`, width: `calc(${pattern.lengthBars * clip.repeatCount / bars * 100}% - 2px)`,
        background: `color-mix(in srgb, color-mix(in srgb, ${color} 88%, white) 80%, transparent)`,
        borderColor: selected ? "rgba(255, 255, 255, 0.85)" : `color-mix(in srgb, ${color}, #fff 8%)` }}>
      <span className="absolute top-[7px] right-7 left-2 z-[1] block overflow-hidden text-[11px] font-bold tracking-[0.055em] text-ellipsis whitespace-nowrap uppercase">{pattern.name} · ×{clip.repeatCount}</span>
      <svg className="absolute inset-x-2 bottom-2 h-16 w-[calc(100%-16px)] opacity-50" aria-hidden="true" viewBox={`0 0 ${steps * clip.repeatCount} ${previewHeight}`} preserveAspectRatio="none">
        <defs>
          <pattern id={marksId} width={steps} height={previewHeight} patternUnits="userSpaceOnUse">
            {pattern.kind === "drum"
              ? pattern.events.map((hit) => <rect key={hit.id} x={hit.startStep} y={hit.soundId === "kick" ? 52 : hit.soundId === "snare" ? 30 : 8} width={0.65} height={14} fill="currentColor" />)
              : pattern.events.map((note) => <rect key={note.id} x={note.startStep}
                y={octaveEnd - note.midiNote - 1 + (1 - MIDI_NOTE_HEIGHT) / 2}
                width={note.lengthSteps} height={MIDI_NOTE_HEIGHT} rx={MIDI_NOTE_HEIGHT / 2} fill="currentColor" />)}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${marksId})`} />
      </svg>
    </button>
    <button type="button" aria-label={`Edit clip ${pattern.name} at bar ${clip.startBar + 1}`} onClick={() => { selectClip(clip.id); onEdit(); }}
      className="absolute top-1 z-[2] rounded px-1 py-0.5 text-[11px] text-black/60 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-violet-300"
      style={{ right: `calc(${100 - (clip.startBar + pattern.lengthBars * clip.repeatCount) / bars * 100}% + 5px)` }}>•••</button>
    <button type="button" data-resize-clip-id={clip.id} aria-label={`Resize repeats for ${pattern.name} at bar ${clip.startBar + 1}`}
      title="Drag to repeat the pattern. Activate to edit the repeat count."
      onClick={() => { selectClip(clip.id); onEdit(); }}
      className="absolute inset-y-0 z-[3] w-2 touch-none cursor-ew-resize rounded-r-[3px] focus-visible:outline-2 focus-visible:outline-violet-300"
      style={{ right: `calc(${100 - (clip.startBar + pattern.lengthBars * clip.repeatCount) / bars * 100}% + 2px)` }} />
    </>
  );
}
