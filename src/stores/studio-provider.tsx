"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import { AudioEngine } from "@/audio";
import type { ProjectPersistenceService, SaveResult } from "@/persistence/service";
import type { Project } from "@/project";
import { createStudioStore, type PersistenceBaseline, type StudioState } from "@/stores/studio-store";

const StudioContext = createContext<StoreApi<StudioState> | null>(null);

export interface StudioPersistenceSession {
  readonly service: ProjectPersistenceService | null;
  readonly baseline: PersistenceBaseline;
}

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

export function StudioProvider({ initialProject, persistenceSession, children }: Readonly<{
  initialProject: Project; persistenceSession: StudioPersistenceSession; children: ReactNode;
}>): ReactElement {
  const audioEngine = useRef<AudioEngine | null>(null);
  // eslint-disable-next-line react-hooks/refs -- The getter runs from store actions, never during render.
  const [store] = useState(() => createStudioStore(
    initialProject,
    () => audioEngine.current,
    persistenceSession.baseline,
  ));
  useEffect(() => {
    const { service } = persistenceSession;
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
    const failUnexpectedSave = (token: number, error: unknown): void => {
      console.error("Project persistence failed unexpectedly", error);
      store.getState().failPersistenceSave(
        token,
        "Project could not be saved in browser storage. Keep this page open and try another edit.",
      );
    };
    const scheduleSave = (state: StudioState): void => {
      if (service === null) return;
      const token = state.beginPersistenceSave();
      let scheduled: Promise<SaveResult>;
      try {
        scheduled = service.scheduleSave(state.project);
      } catch (error: unknown) {
        failUnexpectedSave(token, error);
        return;
      }
      void scheduled.then(
        (result) => store.getState().finishPersistenceSave(token, result),
        (error: unknown) => failUnexpectedSave(token, error),
      );
    };

    const unsubscribe = store.subscribe((state, previous) => {
      if (state.project !== previous.project) {
        engine.replaceProject(state.project);
        state.refreshAudio();
        scheduleSave(state);
      }
      if (state.audio.snapshot.status === "playing" && previous.audio.snapshot.status !== "playing") startFrame();
      if (state.audio.snapshot.status !== "playing" && previous.audio.snapshot.status === "playing") cancelFrame();
    });
    const flushWhenHidden = (): void => {
      if (service === null || document.visibilityState !== "hidden") return;
      const token = store.getState().persistence.latestSaveToken;
      void service.flush().then(
        (result) => store.getState().finishPersistenceSave(token, result),
        (error: unknown) => failUnexpectedSave(token, error),
      );
    };
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", flushWhenHidden);
      cancelFrame();
      if (audioEngine.current === engine) audioEngine.current = null;
      void engine.dispose();
    };
  }, [persistenceSession, store]);
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
