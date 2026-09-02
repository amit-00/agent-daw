"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import { AudioEngine } from "@/audio";
import type { Project } from "@/project";
import { createStudioStore, type StudioState } from "@/stores/studio-store";

const StudioContext = createContext<StoreApi<StudioState> | null>(null);

const createBrowserAudioEngine = (): AudioEngine => new AudioEngine({
  createContext: () => new AudioContext(),
  loadArrayBuffer: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio sample request failed with ${response.status}: ${url}`);
    return response.arrayBuffer();
  },
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (handle) => window.clearInterval(handle as number),
});

export function StudioProvider({ initialProject, children }: Readonly<{
  initialProject: Project; children: ReactNode;
}>): ReactElement {
  const audioEngine = useRef<AudioEngine | null>(null);
  // eslint-disable-next-line react-hooks/refs -- The getter runs from store actions, never during render.
  const [store] = useState(() => createStudioStore(initialProject, () => audioEngine.current, {
    status: "unsaved", updatedAt: null, errorMessage: null,
  }));
  useEffect(() => {
    const engine = createBrowserAudioEngine();
    audioEngine.current = engine;
    engine.replaceProject(store.getState().project);
    store.getState().refreshAudio();

    let frame: number | null = null;
    const cancelFrame = (): void => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };
    const poll = (): void => {
      frame = null;
      store.getState().refreshAudio();
      if (store.getState().audio.snapshot.status === "playing") {
        frame = requestAnimationFrame(poll);
      }
    };
    const startFrame = (): void => {
      if (frame === null) frame = requestAnimationFrame(poll);
    };

    const unsubscribe = store.subscribe((state, previous) => {
      if (state.project !== previous.project) {
        engine.replaceProject(state.project);
        state.refreshAudio();
      }
      if (state.audio.snapshot.status === "playing" && previous.audio.snapshot.status !== "playing") startFrame();
      if (state.audio.snapshot.status !== "playing" && previous.audio.snapshot.status === "playing") cancelFrame();
    });

    return () => {
      unsubscribe();
      cancelFrame();
      if (audioEngine.current === engine) audioEngine.current = null;
      void engine.dispose();
    };
  }, [store]);
  return <StudioContext.Provider value={store}>{children}</StudioContext.Provider>;
}

export function useStudioStoreApi(): StoreApi<StudioState> {
  const store = useContext(StudioContext);
  if (store === null) throw new Error("Studio state requires a StudioProvider. Mount the component inside Studio.");
  return store;
}

export function useStudioStore<T>(selector: (state: StudioState) => T): T {
  const store = useStudioStoreApi();
  return useStore(store, selector);
}
