"use client";

import type { ReactElement } from "react";

import { ActivityPanel } from "@/components/ActivityPanel";
import { Transport } from "@/components/Transport";

export function Studio(): ReactElement {
  return (
    <main className="relative h-dvh min-w-[1180px] overflow-hidden bg-black text-zinc-100">
      <section className="flex h-dvh min-w-0 flex-col overflow-hidden" id="studio">
        <Transport />
      </section>
      <ActivityPanel />
    </main>
  );
}
