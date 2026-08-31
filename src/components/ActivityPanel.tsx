"use client";

import type { ReactElement } from "react";

import { Icon } from "@/components/icons";
import { useStudioStore } from "@/stores/studio-provider";

export function ActivityPanel(): ReactElement | null {
  const { activityOpen, closeActivity, history, historyCursor } = useStudioStore((state) => state);
  if (!activityOpen) return null;
  return (
    <aside className="absolute top-[58px] right-0 bottom-0 z-[9] w-[286px] overflow-hidden border-l border-white/15 bg-[#0d0d10]" aria-label="Activity">
      <div className="flex h-12 items-center justify-between border-b border-white/10 pr-[11px] pl-4">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-200"><Icon name="activity" /> Activity</span>
        <button type="button" aria-label="Close activity" onClick={closeActivity} className="h-6 w-6 rounded-md border-0 bg-transparent text-[17px] leading-none text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">×</button>
      </div>
      <div className="h-[calc(100%-48px)] overflow-y-auto px-[17px] py-6 [scrollbar-color:#29292e_transparent] [scrollbar-width:thin]">
        <span className="block text-[9px] font-semibold tracking-[0.15em] text-zinc-600">LATEST CHANGES</span>
        {history.length === 0 && <p className="mt-4 text-xs text-zinc-500">No changes yet</p>}
        <ol>
          {history.map((entry, index) => (
            <li className={`border-b border-white/5 py-[15px] ${index > historyCursor ? "opacity-40" : ""}`} key={entry.id} aria-current={index === historyCursor ? "step" : undefined}>
              <strong className="block text-[11px] font-medium text-zinc-300">{entry.label}</strong>
              <small className="mt-[5px] block text-[10px] text-zinc-600">{entry.source === "manual" ? "You" : "Agent"} · {new Date(entry.createdAt).toLocaleTimeString()} {index > historyCursor ? "· Undone" : ""}</small>
            </li>
          )).reverse()}
        </ol>
      </div>
    </aside>
  );
}
