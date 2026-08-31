import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Arrangement } from "@/components/arrangement/Arrangement";
import { DEMO_PROJECT } from "@/data/studio-data";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

let state: StudioState;
function Probe(): null {
  const snapshot = useStudioStore((value) => value);
  useEffect(() => { state = snapshot; }, [snapshot]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  render(<StudioProvider initialProject={DEMO_PROJECT}><Arrangement /><Probe /></StudioProvider>);
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
