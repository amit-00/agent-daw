"use client";

import { useRef, useState, type ReactElement } from "react";

import { AddPattern, PatternSettings } from "@/components/editor/PatternControls";
import { useStudioStore } from "@/stores/studio-provider";

export function PatternSidebar(): ReactElement {
  const { project, selectedPatternId, selectPattern } = useStudioStore((state) => state);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingPattern = project.patterns.find((pattern) => pattern.id === editingId);
  return (
    <aside className="min-w-0 overflow-y-auto border-r border-white/10 bg-black/20 px-2.5 py-4" aria-label="Project patterns">
      <div className="relative">
        <span className="block text-[11px] font-semibold tracking-[0.15em] text-zinc-600">PROJECT PATTERNS</span>
        <button ref={addButton} type="button" aria-label="Add pattern" onClick={() => setAdding(true)}
          className="absolute -top-1 right-0 text-[15px] text-zinc-500 hover:text-zinc-300">＋</button>
      </div>
      <div className="mt-3 grid gap-1">
        {project.patterns.map((pattern) => {
          const uses = project.arrangement.filter((clip) => clip.patternId === pattern.id).length;
          const active = selectedPatternId === pattern.id;
          return (
            <div key={pattern.id} className="relative min-w-0">
            <button type="button" data-pattern-id={pattern.id} aria-label={`Select pattern ${pattern.name}`} aria-pressed={active} onClick={() => selectPattern(pattern.id)}
              className={`w-full min-w-0 touch-none cursor-grab rounded-md border px-[9px] py-2 pr-6 text-left ${active ? "border-violet-400/40 bg-violet-400/15 text-violet-100" : "border-transparent bg-transparent text-zinc-500 hover:bg-white/[0.045] hover:text-zinc-300"}`}>
              <strong className="block overflow-hidden text-xs font-semibold text-ellipsis whitespace-nowrap">{pattern.name}</strong>
              <small className={`mt-[3px] block overflow-hidden text-[11px] text-ellipsis whitespace-nowrap ${active ? "text-violet-300/75" : "text-zinc-600"}`}>{pattern.lengthBars} {pattern.lengthBars === 1 ? "bar" : "bars"} · {uses === 0 ? "Unplaced" : `${uses} ${uses === 1 ? "placement" : "placements"}`}</small>
            </button>
            <button type="button" aria-label={`Edit pattern ${pattern.name}`} onClick={() => { selectPattern(pattern.id); setEditingId(pattern.id); }}
              className="absolute top-1 right-1 p-1 text-[11px] text-zinc-500 hover:text-zinc-300">•••</button>
            </div>
          );
        })}
        {project.patterns.length === 0 && <p className="text-xs text-zinc-500">No patterns yet</p>}
      </div>
      {adding && <AddPattern onClose={() => setAdding(false)} />}
      {editingPattern && <PatternSettings key={editingPattern.id} pattern={editingPattern} onClose={() => setEditingId(null)} onDeleted={() => {
        setEditingId(null);
        queueMicrotask(() => addButton.current?.focus());
      }} />}
    </aside>
  );
}
