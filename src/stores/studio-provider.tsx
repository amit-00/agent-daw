"use client";

import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { Project } from "@/project";
import { createStudioStore, type StudioState } from "@/stores/studio-store";

const StudioContext = createContext<StoreApi<StudioState> | null>(null);

export function StudioProvider({ initialProject, children }: Readonly<{
  initialProject: Project; children: ReactNode;
}>): ReactElement {
  const [store] = useState(() => createStudioStore(initialProject, () => null, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  }));
  return <StudioContext.Provider value={store}>{children}</StudioContext.Provider>;
}

export function useStudioStore<T>(selector: (state: StudioState) => T): T {
  const store = useContext(StudioContext);
  if (store === null) throw new Error("Studio state requires a StudioProvider. Mount the component inside Studio.");
  return useStore(store, selector);
}
