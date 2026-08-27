"use client";

import type { ReactElement } from "react";

import { ActivityPanel } from "@/components/ActivityPanel";
import { Transport } from "@/components/Transport";
import { Arrangement } from "@/components/arrangement/Arrangement";

export function Studio(): ReactElement {
  return (
    <main className="relative h-dvh min-w-[1180px] overflow-hidden bg-black text-zinc-100">
      <section className="flex h-dvh min-w-0 flex-col overflow-hidden" id="studio">
        <Transport />
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden">
          <Arrangement />
        </div>
      </section>
      <ActivityPanel />
    </main>
  );
}
