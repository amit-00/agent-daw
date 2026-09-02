import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StudioSession } from "@/components/Studio";
import { StudioProvider, type StudioPersistenceSession } from "@/stores/studio-provider";
import { DEMO_PROJECT } from "@/data/studio-data";
import type { Project } from "@/project";

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

const project: Project = { ...DEMO_PROJECT, tracks: DEMO_PROJECT.tracks.slice(0, 3),
  arrangement: [{ id: "phrase", patternId: "orbit", trackId: "bass", startBar: 1, repeatCount: 1 }] };

let surface: HTMLElement;
let scroller: HTMLElement;
let animationFrames: FrameRequestCallback[];
beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  animationFrames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLDialogElement.prototype.showModal = function (): void { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (): void { this.removeAttribute("open"); };
  render(<StudioProvider initialProject={project} persistenceSession={TEST_PERSISTENCE_SESSION}><StudioSession /></StudioProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
  scroller = screen.getByRole("region", { name: "Song arrangement" }).parentElement!;
  surface = scroller.parentElement!;
  Object.defineProperties(surface, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 954, 500));
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  project.tracks.forEach((track, index) => {
    vi.spyOn(screen.getByRole("region", { name: `${track.name} lane` }), "getBoundingClientRect")
      .mockImplementation(() => new DOMRect(154 - scroller.scrollLeft, 39 + index * 112 - scroller.scrollTop,
        Number(arrangement.dataset.bars) * 100, 112));
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function start(name: string, clientX: number, clientY: number): void {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { pointerId: 1, button: 0, clientX, clientY });
}
function move(clientX: number, clientY: number): void {
  fireEvent.pointerMove(surface, { pointerId: 1, clientX, clientY });
}
function release(clientX: number, clientY: number): void {
  fireEvent.pointerUp(surface, { pointerId: 1, clientX, clientY });
  fireEvent.lostPointerCapture(surface, { pointerId: 1 });
}
function historyCount(): number {
  return within(screen.getByRole("complementary", { name: "Activity" })).queryAllByRole("listitem").length;
}

it("previews a snapped clip move, preserving the grab offset, and commits once on release", () => {
  start("Select Low Orbit phrase", 314, 200);
  move(434, 200);
  expect(screen.getByRole("status")).toHaveTextContent(/bar 3/i);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "6.25%" });
  expect(historyCount()).toBe(0);
  release(434, 200);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "12.5%" });
  expect(historyCount()).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "6.25%" });
});

it("moves across compatible tracks without copying the shared pattern", () => {
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  release(414, 300);
  expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "12.5%" });
  expect(screen.getByRole("button", { name: "Select pattern Low Orbit phrase" })).toHaveTextContent("1 placement");
  expect(historyCount()).toBe(1);
});

it("accounts for horizontal and vertical scrolling during a captured drag", () => {
  start("Select Low Orbit phrase", 314, 200);
  scroller.scrollLeft = 200;
  scroller.scrollTop = 112;
  fireEvent.scroll(scroller);
  release(314, 200);
  expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Edit clip Low Orbit phrase at bar 4" })).toBeVisible();
  expect(historyCount()).toBe(1);
});

it("scrolls before extending its fixed-width sixteen-bar timeline", () => {
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  const lane = screen.getByRole("region", { name: "Low Orbit lane" });
  vi.mocked(lane.getBoundingClientRect).mockImplementation(() =>
    new DOMRect(154 - scroller.scrollLeft, 151 - scroller.scrollTop, Number(arrangement.dataset.bars) * 100, 112));
  Object.defineProperties(scroller, {
    clientWidth: { value: 954, configurable: true },
    scrollWidth: { get: () => Number.parseFloat(arrangement.style.width), configurable: true },
  });
  start("Select Low Orbit phrase", 314, 200);
  move(940, 200);
  expect(arrangement).toHaveAttribute("data-bars", "16");
  expect(arrangement).toHaveStyle({ width: "1754px" });
  act(() => animationFrames.shift()?.(16));
  expect(scroller.scrollLeft).toBeGreaterThan(0);
  expect(arrangement).toHaveAttribute("data-bars", "16");
  expect(arrangement).toHaveStyle({ width: "1754px" });
});

it("uses the visible clip area as the left scrolling boundary", () => {
  const arrangement = screen.getByRole("region", { name: "Song arrangement" });
  vi.spyOn(arrangement.firstElementChild as HTMLElement, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 250, 39));
  Object.defineProperties(scroller, {
    clientWidth: { value: 954, configurable: true },
    scrollWidth: { value: 2_000, configurable: true },
  });
  start("Select Low Orbit phrase", 314, 200);
  scroller.scrollLeft = 400;
  fireEvent.scroll(scroller);
  move(200, 200);
  expect(animationFrames).toHaveLength(0);
  move(260, 200);
  expect(animationFrames).toHaveLength(1);
  act(() => animationFrames.shift()?.(16));
  expect(scroller.scrollLeft).toBeLessThan(400);
});

it("clamps a moved clip to its final valid starting bar", () => {
  start("Select Low Orbit phrase", 314, 200);
  move(940, 200);
  scroller.scrollLeft = 25_000;
  fireEvent.scroll(scroller);
  release(940, 200);
  expect(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 255" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Song arrangement" })).toHaveAttribute("data-bars", "256");
});

it("drags a library pattern to the same bar mapping as empty-lane creation", () => {
  start("Select pattern Unused idea", 80, 600);
  move(404, 300);
  expect(historyCount()).toBe(0);
  release(404, 300);
  expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Edit clip Unused idea at bar 3" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Select pattern Unused idea" })).toHaveTextContent("1 placement");
  expect(historyCount()).toBe(1);
});

it("uses the final release position after the pointer leaves the library", () => {
  start("Select pattern Unused idea", 80, 600);
  move(80, 500);
  release(404, 300);
  expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Edit clip Unused idea at bar 3" })).toBeVisible();
  expect(historyCount()).toBe(1);
});

it("keeps keyboard focus on a clip after moving it to another track", async () => {
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  await act(async () => { release(414, 300); });
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveFocus();
});

it("does not scroll a partially visible clip into view when a drag starts", () => {
  const clip = screen.getByRole("button", { name: "Select Low Orbit phrase" });
  vi.spyOn(clip, "focus").mockImplementation((options?: FocusOptions): void => {
    if (!options?.preventScroll) scroller.scrollTop = 112;
  });
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  release(414, 300);
  expect(within(screen.getByRole("region", { name: "Glasshouse lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "12.5%" });
});

it.each(["source", "destination"])("refuses a release after the %s is deleted", (deleted) => {
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  expect(screen.getByRole("status")).toHaveTextContent(/bar 3/i);
  if (deleted === "source") {
    fireEvent.click(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete clip" }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Edit Glasshouse" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete track" }));
  }
  release(414, 300);
  expect(screen.getByRole("alert")).toHaveTextContent(deleted === "source" ? /no longer exists/i : /not found/i);
  expect(historyCount()).toBe(1);
});

it("ignores a second pointer and clamps a move before the first bar", () => {
  start("Select Low Orbit phrase", 354, 200);
  move(180, 200);
  fireEvent.pointerCancel(surface, { pointerId: 2 });
  fireEvent.pointerUp(surface, { pointerId: 2, clientX: 500, clientY: 300 });
  release(180, 200);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "0%" });
  expect(historyCount()).toBe(1);
});

it("bounds repeat resizing to 1–64 without changing pattern content", () => {
  start("Resize repeats for Low Orbit phrase at bar 2", 452, 200);
  move(0, 600);
  release(0, 600);
  expect(historyCount()).toBe(0);
  start("Resize repeats for Low Orbit phrase at bar 2", 452, 200);
  move(20000, 600);
  release(20000, 600);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×64");
  expect(screen.getByRole("region", { name: "Pattern editor for Low Orbit phrase" })).toHaveTextContent("4 notes");
  expect(screen.getByRole("region", { name: "Song arrangement" })).toHaveStyle({ width: "13454px" });
  expect(historyCount()).toBe(1);
});

it("refuses repeat growth beyond the final arrangement bar", () => {
  fireEvent.click(screen.getByRole("button", { name: "Edit clip Low Orbit phrase at bar 2" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Starting bar" }), { target: { value: "255" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply placement" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("region", { name: "Song arrangement" })).toHaveAttribute("data-bars", "256");
  start("Resize repeats for Low Orbit phrase at bar 255", 950, 200);
  move(1_150, 200);
  release(1_150, 200);
  expect(screen.getByRole("alert")).toHaveTextContent(/256/);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×1");
  expect(historyCount()).toBe(1);
});

it("rechecks collisions introduced while a drag is in progress", () => {
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  fireEvent.doubleClick(screen.getByRole("region", { name: "Glasshouse lane" }), { clientX: 404 });
  release(414, 300);
  expect(screen.getByRole("alert")).toHaveTextContent(/overlap/i);
  expect(within(screen.getByRole("region", { name: "Low Orbit lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "6.25%" });
  expect(historyCount()).toBe(1);
});

it("opens the repeat-count alternative with keyboard activation", () => {
  const handle = screen.getByRole("button", { name: "Resize repeats for Low Orbit phrase at bar 2" });
  handle.focus();
  fireEvent.click(handle, { detail: 0 });
  expect(screen.getByRole("spinbutton", { name: "Repeat count" })).toHaveValue(1);
  expect(historyCount()).toBe(0);
});

it("allows selecting an unplaced pattern after the last track is removed", () => {
  for (const track of project.tracks) {
    fireEvent.click(screen.getByRole("button", { name: `Edit ${track.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Delete track" }));
    const confirm = screen.queryByRole("button", { name: "Confirm delete" });
    if (confirm) fireEvent.click(confirm);
  }
  start("Select pattern Unused idea", 80, 600);
  release(80, 600);
  expect(screen.getByRole("button", { name: "Select pattern Unused idea" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(historyCount()).toBe(3);
});

it("resizes by whole patterns and creates one undoable repeat change", () => {
  start("Resize repeats for Low Orbit phrase at bar 2", 452, 200);
  move(652, 200);
  expect(screen.getByRole("status")).toHaveTextContent(/×2/);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×1");
  expect(historyCount()).toBe(0);
  release(652, 200);
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×2");
  expect(historyCount()).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Select Low Orbit phrase" })).toHaveTextContent("×1");
});

it.each(["pointercancel", "escape", "lostcapture"])("cancels a clip preview on %s without edits", (cancel) => {
  start("Select Low Orbit phrase", 314, 200);
  move(414, 300);
  expect(screen.getByRole("status")).toHaveTextContent(/bar 3/i);
  if (cancel === "pointercancel") fireEvent.pointerCancel(surface, { pointerId: 1 });
  if (cancel === "escape") fireEvent.keyDown(surface, { key: "Escape" });
  if (cancel === "lostcapture") fireEvent.lostPointerCapture(surface, { pointerId: 1 });
  release(414, 300);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Low Orbit lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "6.25%" });
  expect(historyCount()).toBe(0);
});

it.each([
  { x: 414, y: 90, error: /same kind/i },
  { x: 40, y: 200, error: /track lane/i },
  { x: 414, y: 550, error: /track lane/i },
])("refuses an invalid clip drop at $x,$y without history", ({ x, y, error }) => {
  start("Select Low Orbit phrase", 314, 200);
  move(x, y);
  release(x, y);
  expect(screen.getByRole("alert")).toHaveTextContent(error);
  expect(within(screen.getByRole("region", { name: "Low Orbit lane" })).getByRole("button", { name: "Select Low Orbit phrase" })).toHaveStyle({ left: "6.25%" });
  expect(historyCount()).toBe(0);
});

it("refuses a library placement overlapping an existing clip", () => {
  start("Select pattern Unused idea", 80, 600);
  move(304, 200);
  release(304, 200);
  expect(screen.getByRole("alert")).toHaveTextContent(/overlap/i);
  expect(screen.getByRole("button", { name: "Select pattern Unused idea" })).toHaveTextContent("Unplaced");
  expect(historyCount()).toBe(0);
});

it("does not commit a stationary clip press or a cancelled library drag", () => {
  start("Select Low Orbit phrase", 314, 200);
  release(314, 200);
  start("Select pattern Unused idea", 80, 600);
  move(404, 300);
  expect(screen.getByRole("status")).toHaveTextContent(/bar 3/i);
  fireEvent.keyDown(surface, { key: "Escape" });
  release(404, 300);
  expect(screen.getByRole("button", { name: "Select pattern Unused idea" })).toHaveTextContent("Unplaced");
  expect(historyCount()).toBe(0);
});
