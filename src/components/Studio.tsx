"use client";

import type { ReactElement } from "react";

import { ActivityPanel } from "@/components/ActivityPanel";
import { Transport } from "@/components/Transport";
import { Arrangement } from "@/components/arrangement/Arrangement";
import { ArrangementGestures } from "@/components/arrangement/ArrangementGestures";
import { TrackEditor } from "@/components/editor/TrackEditor";
import type { Project } from "@/project";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";

function StudioSession(): ReactElement {
  const errorMessage = useStudioStore((state) => state.errorMessage);
  return (
    <main className="relative h-dvh min-w-[1180px] overflow-hidden bg-black text-zinc-100">
      <section className="flex h-dvh min-w-0 flex-col overflow-hidden" id="studio">
        <Transport />
        {errorMessage && <p role="alert" className="border-b border-rose-400/20 bg-rose-950/60 px-4 py-2 text-xs text-rose-200">{errorMessage}</p>}
        <ArrangementGestures>
          <Arrangement />
          <TrackEditor />
        </ArrangementGestures>
      </section>
      <ActivityPanel />
    </main>
  );
}

export function Studio({ initialProject }: Readonly<{ initialProject: Project }>): ReactElement {
  return <StudioProvider initialProject={initialProject}><StudioSession /></StudioProvider>;
}
