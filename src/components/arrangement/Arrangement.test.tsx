import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

import { Arrangement } from "@/components/arrangement/Arrangement";
import { DEMO_PROJECT } from "@/data/studio-data";
import { StudioProvider, useStudioStore, useStudioStoreApi, type StudioPersistenceSession } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

const TEST_PERSISTENCE_SESSION: StudioPersistenceSession = {
  service: null,
  baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
};

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

let state: StudioState;
let store: StoreApi<StudioState>;
function Probe(): null {
  const snapshot = useStudioStore((value) => value);
  const storeApi = useStudioStoreApi();
  useEffect(() => { state = snapshot; store = storeApi; }, [snapshot, storeApi]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  render(<StudioProvider initialProject={DEMO_PROJECT} persistenceSession={TEST_PERSISTENCE_SESSION}><Arrangement /><Probe /></StudioProvider>);
});
afterEach(() => vi.unstubAllGlobals());

function startDrag(): HTMLElement {
  const handle = screen.getByRole("button", { name: "Reorder Neon Kit" });
  Object.defineProperties(handle, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
  return handle;
}

it("starts with sixteen fixed-width bars", () => {
  expect(screen.getByRole("region", { name: "Song arrangement" }))
    .toHaveAttribute("data-bars", "16");
  expect(screen.getByRole("region", { name: "Song arrangement" }))
    .toHaveStyle({ width: "1754px" });
});

it("renders a draggable playhead in timeline content coordinates", () => {
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  expect(arrangement).toContainElement(playhead);
  expect(playhead).toHaveAttribute("aria-valuenow", "0");
  expect(playhead).toHaveClass("cursor-col-resize");
  expect(playhead).toHaveStyle({ left: "154px" });
});

it("renders the engine position and clamps seeking to arrangement content", () => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_754, 650));
  Object.defineProperties(playhead, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });

  act(() => store.getState().seekPlayback(32));
  expect(playhead).toHaveAttribute("aria-valuenow", "32");

  fireEvent.pointerDown(playhead, { pointerId: 2, button: 0, clientX: 354 });
  fireEvent.pointerMove(playhead, { pointerId: 2, clientX: 5_000 });
  fireEvent.pointerUp(playhead, { pointerId: 2, clientX: 5_000 });
  expect(playhead).toHaveAttribute(
    "aria-valuenow",
    String(store.getState().audio.snapshot.arrangementEndStep),
  );
  expect(playhead).toHaveAttribute(
    "aria-valuemax",
    String(store.getState().audio.snapshot.arrangementEndStep),
  );
});

it("previews pointer movement but seeks the engine once on release", () => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_754, 650));
  Object.defineProperties(playhead, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  const committedBeforeDrag = store.getState().audio.snapshot.positionStep;

  fireEvent.pointerDown(playhead, { pointerId: 3, button: 0, clientX: 154 });
  fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 254 });
  fireEvent.pointerMove(playhead, { pointerId: 3, clientX: 354 });
  const previewStep = Number(playhead.getAttribute("aria-valuenow"));
  expect(previewStep).not.toBe(committedBeforeDrag);
  expect(store.getState().audio.snapshot.positionStep).toBe(committedBeforeDrag);

  fireEvent.pointerUp(playhead, { pointerId: 3, clientX: 354 });
  expect(store.getState().audio.snapshot.positionStep).toBe(previewStep);
});

it.each(["pointercancel", "lostcapture"])("discards a playhead preview on %s without seeking", (cancel) => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_754, 650));
  Object.defineProperties(playhead, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  const committedStep = store.getState().audio.snapshot.positionStep;

  fireEvent.pointerDown(playhead, { pointerId: 4, button: 0, clientX: 154 });
  fireEvent.pointerMove(playhead, { pointerId: 4, clientX: 354 });
  if (cancel === "pointercancel") fireEvent.pointerCancel(playhead, { pointerId: 4 });
  if (cancel === "lostcapture") fireEvent.lostPointerCapture(playhead, { pointerId: 4 });

  expect(playhead).toHaveAttribute("aria-valuenow", String(committedStep));
  expect(store.getState().audio.snapshot.positionStep).toBe(committedStep);
});

it("snaps a dragged playhead without moving it when the arrangement scrolls", () => {
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  const scroller = arrangement.parentElement!;
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  vi.spyOn(arrangement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1_754, 650));
  Object.defineProperties(playhead, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });

  fireEvent.pointerDown(playhead, { pointerId: 2, button: 0, clientX: 154 });
  fireEvent.pointerMove(playhead, { pointerId: 2, clientX: 407 });
  fireEvent.pointerUp(playhead, { pointerId: 2, clientX: 407 });
  expect(playhead).toHaveAttribute("aria-valuenow", "40");
  expect(playhead).toHaveStyle({ left: "404px" });
  expect(store.getState().audio.snapshot.positionStep).toBe(40);
  expect(state.history).toHaveLength(0);

  scroller.scrollLeft = 300;
  fireEvent.scroll(scroller);
  expect(playhead).toHaveAttribute("aria-valuenow", "40");
  expect(playhead).toHaveStyle({ left: "404px" });
  expect(store.getState().audio.snapshot.positionStep).toBe(40);
});

it("moves the playhead one step with the arrow keys", () => {
  const playhead = screen.getByRole("slider", { name: "Playhead" });
  fireEvent.keyDown(playhead, { key: "ArrowRight" });
  expect(playhead).toHaveAttribute("aria-valuenow", "1");
  expect(playhead).toHaveStyle({ left: "160.25px" });
  expect(store.getState().audio.snapshot.positionStep).toBe(1);
  fireEvent.keyDown(playhead, { key: "ArrowLeft" });
  fireEvent.keyDown(playhead, { key: "ArrowLeft" });
  expect(playhead).toHaveAttribute("aria-valuenow", "0");
  expect(store.getState().audio.snapshot.positionStep).toBe(0);
});

it("previews track order but commits only once on release, with undo", () => {
  const handle = startDrag();
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 324 });
  expect(screen.getByRole("group", { name: "Neon Kit track" })).toHaveStyle({ gridRow: "4" });
  expect(state.project).toEqual(DEMO_PROJECT);
  expect(state.history).toHaveLength(0);
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 324 });
  fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  expect(state.project.tracks[2]?.id).toBe("drums");
  expect(state.history).toHaveLength(1);
  act(() => state.undo());
  expect(state.project).toEqual(DEMO_PROJECT);
});

it.each(["pointercancel", "escape", "lostcapture"])("cancels a track preview on %s without history", (cancel) => {
  const handle = startDrag();
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 324 });
  if (cancel === "pointercancel") fireEvent.pointerCancel(handle, { pointerId: 1 });
  if (cancel === "escape") fireEvent.keyDown(handle, { key: "Escape" });
  if (cancel === "lostcapture") fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 324 });
  expect(state.project).toEqual(DEMO_PROJECT);
  expect(state.history).toHaveLength(0);
  expect(screen.getByRole("group", { name: "Neon Kit track" })).toHaveStyle({ gridRow: "2" });
});

it("accounts for scrolling and does not record a stationary drag", () => {
  let handle = startDrag();
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });
  expect(state.history).toHaveLength(0);
  handle = startDrag();
  const scroller = screen.getByRole("region", { name: "Song arrangement" }).parentElement!;
  scroller.scrollTop = 224;
  fireEvent.scroll(scroller);
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });
  expect(state.project.tracks[2]?.id).toBe("drums");
  expect(state.history).toHaveLength(1);
});

it("discards a drag when its track list changes before release", () => {
  const handle = startDrag();
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 324 });
  act(() => state.deleteTrack("bass"));
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 324 });
  expect(state.project.tracks[0]?.id).toBe("drums");
  expect(state.history).toHaveLength(1);
});
