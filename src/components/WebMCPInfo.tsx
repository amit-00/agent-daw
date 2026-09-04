"use client";

import { useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { useStudioStore } from "@/stores/studio-provider";
import type { WebMCPStatus } from "@/stores/studio-store";
import { TOOL_CONTRACTS } from "@/webmcp/contracts";

interface ToolGroup {
  readonly label: string;
  readonly tools: string;
  readonly description: string;
}

const TOOL_GROUPS: readonly ToolGroup[] = [
  { label: "Inspect", tools: "get_project · get_sound_catalog · get_history", description: "Read the current song, available sounds, and edit history." },
  { label: "Transport", tools: "play · pause · stop · seek · export_wav", description: "Control playback or render the current project." },
  { label: "Project & tracks", tools: "rename_project · create_track · set_track_mix", description: "Shape the song, track order, instruments, and mix." },
  { label: "Patterns & clips", tools: "create_pattern · duplicate_pattern · move_clip", description: "Create or duplicate reusable patterns with a required placement, then arrange their clips." },
  { label: "Notes & drums", tools: "add_notes · edit_notes · add_drum_hits", description: "Write and revise synth notes or drum hits." },
  { label: "History & batches", tools: "undo · redo · restore_history · apply_project_changes", description: "Recover edits or commit coordinated changes atomically." },
];

const STATUS_COPY: Readonly<Record<WebMCPStatus, string>> = {
  unsupported: "This browser does not expose WebMCP tools.",
  registering: "AgentDAW is registering its WebMCP tools.",
  ready: `${TOOL_CONTRACTS.length} tools are available while this page is open.`,
  failed: "Tool registration failed. Reload the page to retry.",
};

const STATUS_DOT: Readonly<Record<WebMCPStatus, string>> = {
  unsupported: "bg-zinc-600",
  registering: "bg-amber-400",
  ready: "bg-emerald-400",
  failed: "bg-rose-400",
};

const statusLabel = (status: WebMCPStatus): string => status[0]!.toUpperCase() + status.slice(1);

function BotIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2m16 0h2M9 13v2m6-2v2" />
    </svg>
  );
}

function WebMCPDialog({ status, onClose }: Readonly<{
  status: WebMCPStatus;
  onClose: () => void;
}>): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const label = statusLabel(status);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label="WebMCP"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[86vh] w-[640px] overflow-y-auto rounded-[14px] border border-white/15 bg-zinc-950/75 p-0 text-zinc-200 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
    >
      <header className="flex items-start justify-between border-b border-white/10 px-6 py-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">WebMCP</h2>
          <p className="mt-1 text-[11px] text-zinc-400">Structured website tools that compatible AI agents can discover and use.</p>
        </div>
        <button type="button" aria-label="Close WebMCP details" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-lg leading-none text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">×</button>
      </header>

      <div className="space-y-5 px-6 py-5 text-xs text-zinc-400">
        <section aria-labelledby="webmcp-about">
          <h3 id="webmcp-about" className="font-semibold text-zinc-200">What is WebMCP?</h3>
          <p className="mt-2 leading-5">WebMCP lets AgentDAW expose clear, structured actions to compatible AI agents. Those actions can inspect, play, arrange, and edit this project through the same controls and validation used by the interface.</p>
        </section>

        <section role="status" aria-label={`WebMCP status: ${label}`} className="rounded-[10px] border border-white/10 bg-white/[0.055] px-4 py-3">
          <strong className="flex items-center gap-2 text-xs text-zinc-200"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />{label}</strong>
          <p className="mt-1.5 pl-3.5 text-[11px] text-zinc-400">{STATUS_COPY[status]}</p>
        </section>

        <h3 className="text-[11px] font-semibold text-zinc-300">Example tools</h3>
        <div className="grid grid-cols-2 gap-2">
          {TOOL_GROUPS.map((group) => (
            <section key={group.label} className="rounded-[9px] border border-white/10 bg-black/15 p-3">
              <h3 className="text-[11px] font-semibold text-zinc-300">{group.label}</h3>
              <code className="mt-1.5 block text-[11px] leading-4 text-violet-300">{group.tools}</code>
              <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">{group.description}</p>
            </section>
          ))}
        </div>

        <section className="border-t border-white/10 pt-5" aria-labelledby="webmcp-prompts">
          <h3 id="webmcp-prompts" className="text-[11px] font-medium text-zinc-400">Try asking</h3>
          <ul className="mt-2 grid gap-2 text-[11px] text-zinc-400">
            <li className="rounded-lg bg-white/[0.04] px-3 py-2">“Summarize this project and suggest one arrangement improvement.”</li>
            <li className="rounded-lg bg-white/[0.04] px-3 py-2">“Create a two-bar drum pattern and place it at bar 9.”</li>
            <li className="rounded-lg bg-white/[0.04] px-3 py-2">“Lower the bass track by 3 dB, then export the project as WAV.”</li>
          </ul>
        </section>

        <p className="border-t border-white/10 pt-5 text-[11px] leading-4 text-zinc-400">AgentDAW tools operate on this browser’s local project while the page is open. They do not add cloud sync, analytics, or a server-side copy.</p>
      </div>
    </dialog>
  );
}

export function WebMCPInfo(): ReactElement {
  const status = useStudioStore((state) => state.webMCPStatus);
  const [open, setOpen] = useState(false);
  const label = statusLabel(status);

  return (
    <>
      <button
        type="button"
        aria-label="WebMCP"
        title={`WebMCP: ${label}`}
        onClick={() => setOpen(true)}
        className="flex items-center gap-[7px] rounded-[7px] border border-transparent bg-transparent px-2.5 py-2 text-xs text-zinc-400 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
        <BotIcon />
        <span>WebMCP</span>
      </button>
      <span role="status" aria-label={`WebMCP status: ${label}`} className="sr-only">WebMCP: {label}</span>
      {open && <WebMCPDialog status={status} onClose={() => setOpen(false)} />}
    </>
  );
}
