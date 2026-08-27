"use client";

import type { ReactElement } from "react";

import { Mixer } from "@/components/editor/Mixer";
import { PatternEditor } from "@/components/editor/PatternEditor";
import { Icon } from "@/components/icons";
import { useStudioStore } from "@/stores/studio-store";

export function TrackEditor(): ReactElement {
  const editorTab = useStudioStore((state) => state.editorTab);
  const selectEditorTab = useStudioStore((state) => state.selectEditorTab);

  return (
    <aside className="relative z-[3] min-h-0 overflow-hidden border-t border-white/15 bg-[#0d0d10]" aria-label="Track editor">
      <div className="relative z-[1] grid h-[42px] grid-cols-[1fr_auto_1fr] items-center border-b border-white/10 pr-[11px] pl-[15px]">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Icon name={editorTab === "pattern" ? "draw" : "mixer"} /> Track editor</span>
        <div className="flex rounded-md border border-white/10 bg-black/20 p-[3px]" aria-label="Editor tabs">
          <button className={`rounded border-0 px-[9px] py-1 text-[10px] ${editorTab === "pattern" ? "bg-white/[0.08] text-zinc-300" : "bg-transparent text-zinc-600"}`} type="button" aria-pressed={editorTab === "pattern"} onClick={() => selectEditorTab("pattern")}>Pattern</button>
          <button className={`rounded border-0 px-[9px] py-1 text-[10px] ${editorTab === "mixer" ? "bg-white/[0.08] text-zinc-300" : "bg-transparent text-zinc-600"}`} type="button" aria-pressed={editorTab === "mixer"} onClick={() => selectEditorTab("mixer")}>Mixer</button>
        </div>
      </div>
      {editorTab === "pattern" ? <PatternEditor /> : <Mixer />}
    </aside>
  );
}
