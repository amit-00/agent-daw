"use client";

import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";

import { ActivityPanel } from "@/components/ActivityPanel";
import { Transport, type ProjectChoice } from "@/components/Transport";
import { Arrangement } from "@/components/arrangement/Arrangement";
import { ArrangementGestures } from "@/components/arrangement/ArrangementGestures";
import { TrackEditor } from "@/components/editor/TrackEditor";
import { EMPTY_PROJECT } from "@/data/studio-data";
import { ProjectPersistenceService, type LoadResult } from "@/persistence/service";
import type { Project } from "@/project";
import { StudioProvider, useStudioStore, type StudioPersistenceSession } from "@/stores/studio-provider";
import { WebMCPBridge } from "@/webmcp/WebMCPBridge";

type StartupState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly sessionKey: string;
      readonly project: Project;
      readonly persistenceSession: StudioPersistenceSession;
    }
  | {
      readonly kind: "recovery";
      readonly service: ProjectPersistenceService;
      readonly errorMessage: string;
      readonly clearing: boolean;
    };

const startupFor = (
  result: LoadResult,
  fallback: Project,
  service: ProjectPersistenceService,
): StartupState => {
  if (result.status === "loaded") {
    return {
      kind: "ready",
      sessionKey: crypto.randomUUID(),
      project: result.project,
      persistenceSession: {
        service,
        baseline: { status: "saved", updatedAt: result.updatedAt, errorMessage: null },
      },
    };
  }
  if (result.status === "empty") {
    return {
      kind: "ready",
      sessionKey: crypto.randomUUID(),
      project: fallback,
      persistenceSession: {
        service,
        baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
      },
    };
  }
  if (result.error.code === "corrupt_record" || result.error.code === "unsupported_schema") {
    return { kind: "recovery", service, errorMessage: result.error.message, clearing: false };
  }
  return {
    kind: "ready",
    sessionKey: crypto.randomUUID(),
    project: fallback,
    persistenceSession: {
      service,
      baseline: { status: "memory-only", updatedAt: null, errorMessage: result.error.message },
    },
  };
};

export function StudioSession({ onStartProject }: Readonly<{
  onStartProject?: (choice: ProjectChoice) => Promise<string | null>;
}>): ReactElement {
  const errorMessage = useStudioStore((state) => state.errorMessage);
  const audio = useStudioStore((state) => state.audio);
  const persistence = useStudioStore((state) => state.persistence);
  const history = useStudioStore((state) => state.history);
  const historyCursor = useStudioStore((state) => state.historyCursor);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const [previewEndBar, setPreviewEndBar] = useState<number | null>(null);
  const audioMessage = audio.snapshot.status === "closed"
    ? "Audio engine is closed. Reload to restore playback."
    : audio.errorMessage ?? (audio.snapshot.unavailableSoundIds.length > 0
      ? `Playback is degraded: ${audio.snapshot.unavailableSoundIds.join(", ")} unavailable.`
      : audio.snapshot.lastIssue?.message ?? null);

  function handleKeyboard(event: KeyboardEvent<HTMLElement>): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || document.querySelector("dialog[open]")) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey && historyCursor < history.length - 1) {
      event.preventDefault();
      redo();
    } else if ((event.metaKey || event.ctrlKey) && key === "z" && historyCursor >= 0) {
      event.preventDefault();
      undo();
    } else if (event.ctrlKey && key === "y" && historyCursor < history.length - 1) {
      event.preventDefault();
      redo();
    }
  }

  return (
    <>
    <WebMCPBridge />
    <main className="relative h-dvh min-w-[1180px] overflow-hidden bg-black text-zinc-100" onKeyDown={handleKeyboard}>
      <section className="flex h-dvh min-w-0 flex-col overflow-hidden" id="studio">
        <Transport onStartProject={onStartProject} />
        {errorMessage && <p role="alert" className="border-b border-rose-400/20 bg-rose-950/60 px-4 py-2 text-xs text-rose-200">{errorMessage}</p>}
        {audioMessage && <p role="alert" className="border-b border-amber-400/20 bg-amber-950/60 px-4 py-2 text-xs text-amber-100">Audio: {audioMessage}</p>}
        {persistence.errorMessage && <p role="alert" className="border-b border-rose-400/20 bg-rose-950/60 px-4 py-2 text-xs text-rose-200">Storage: {persistence.errorMessage}</p>}
        <ArrangementGestures onPreviewEndBar={setPreviewEndBar}>
          <Arrangement previewEndBar={previewEndBar} />
          <TrackEditor />
        </ArrangementGestures>
      </section>
      <ActivityPanel />
    </main>
    </>
  );
}

export function Studio({ initialProject }: Readonly<{ initialProject: Project }>): ReactElement {
  const [startup, setStartup] = useState<StartupState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    if (typeof globalThis.indexedDB === "undefined") {
      queueMicrotask(() => {
        if (active) {
          setStartup({
            kind: "ready",
            sessionKey: crypto.randomUUID(),
            project: initialProject,
            persistenceSession: {
              service: null,
              baseline: {
                status: "memory-only",
                updatedAt: null,
                errorMessage: "Browser storage is unavailable. Changes remain in memory until this page closes.",
              },
            },
          });
        }
      });
      return () => { active = false; };
    }
    const service = new ProjectPersistenceService({ indexedDB: globalThis.indexedDB, debounceMs: 500 });
    void service.load().then((result) => {
      if (active) setStartup(startupFor(result, initialProject, service));
    });
    return () => { active = false; };
  }, [initialProject]);

  if (startup.kind === "loading") {
    return <p role="status" aria-label="Loading project">Loading project…</p>;
  }
  if (startup.kind === "recovery") {
    const clearStoredProject = async (): Promise<void> => {
      setStartup({ ...startup, clearing: true });
      const result = await startup.service.clear();
      if (result.status === "failed") {
        setStartup({ ...startup, errorMessage: result.error.message, clearing: false });
        return;
      }
      setStartup({
        kind: "ready",
        sessionKey: crypto.randomUUID(),
        project: initialProject,
        persistenceSession: {
          service: startup.service,
          baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
        },
      });
    };
    return (
      <main>
        <p role="alert">Stored project cannot be loaded. {startup.errorMessage}</p>
        <button type="button" disabled={startup.clearing} onClick={() => { void clearStoredProject(); }}>
          {startup.clearing ? "Clearing stored project" : "Clear stored project"}
        </button>
      </main>
    );
  }
  const ready = startup;
  const startProject = async (choice: ProjectChoice): Promise<string | null> => {
    const service = ready.persistenceSession.service;
    if (service !== null) {
      const result = await service.clear();
      if (result.status === "failed") return result.error.message;
    }
    const project = choice === "blank"
      ? { ...EMPTY_PROJECT, id: crypto.randomUUID() }
      : structuredClone(initialProject);
    setStartup({
      kind: "ready",
      sessionKey: crypto.randomUUID(),
      project,
      persistenceSession: {
        service,
        baseline: service === null
          ? ready.persistenceSession.baseline
          : { status: "unsaved", updatedAt: null, errorMessage: null },
      },
    });
    return null;
  };
  return (
    <StudioProvider key={ready.sessionKey} initialProject={ready.project} persistenceSession={ready.persistenceSession}>
      <StudioSession onStartProject={startProject} />
    </StudioProvider>
  );
}
