import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrumGrid } from "@/components/editor/DrumGrid";
import { EMPTY_PROJECT } from "@/data/studio-data";
import type { DrumPattern, Project } from "@/project";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const beat: DrumPattern = { id: "beat", name: "Beat", kind: "drum", lengthBars: 1, events: [] };
let state: StudioState;
function Probe(): null {
  const snapshot = useStudioStore((value) => value);
  useEffect(() => { state = snapshot; }, [snapshot]);
  return null;
}

function Harness({ patternId }: Readonly<{ patternId: string }>): React.ReactElement | null {
  const pattern = useStudioStore((value) => value.project.patterns.find((item) => item.id === patternId));
  return pattern?.kind === "drum" ? <DrumGrid pattern={pattern} /> : null;
}

function mount(pattern: DrumPattern = beat): HTMLElement {
  const project: Project = { ...EMPTY_PROJECT, patterns: [pattern] };
  render(<StudioProvider initialProject={project}><Harness patternId={pattern.id} /><Probe /></StudioProvider>);
  const grid = screen.getByRole("region", { name: `Drum grid for ${pattern.name}` });
  Object.defineProperties(grid, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  const cells = grid.querySelector<HTMLElement>("[data-drum-cells]")!;
  vi.spyOn(cells, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, pattern.lengthBars * 384, 90));
  return grid;
}

beforeEach(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DrumGrid", () => {
  it("toggles one real hit with click or keyboard activation", async () => {
    const user = userEvent.setup();
    mount();
    const kick = screen.getByRole("button", { name: "Add Kick at step 1" });
    fireEvent.pointerDown(kick, { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    fireEvent.pointerUp(screen.getByRole("region", { name: "Drum grid for Beat" }), { pointerId: 1, clientX: 12, clientY: 15 });
    expect(screen.getByRole("button", { name: "Remove Kick at step 1" })).toHaveAttribute("aria-pressed", "true");
    expect(state.project.patterns[0]?.events).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    screen.getByRole("button", { name: "Add Snare at step 2" }).focus();
    await user.keyboard("{Enter}");
    expect(state.project.patterns[0]?.events).toHaveLength(2);
    expect(state.history).toHaveLength(2);
  });

  it("previews a multi-cell paint stroke and commits it once on release", () => {
    const grid = mount();
    const kick = screen.getByRole("button", { name: "Add Kick at step 1" });
    fireEvent.pointerDown(kick, { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 36, clientY: 15 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 12, clientY: 15 });
    expect(screen.getByRole("button", { name: "Remove Kick at step 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove Kick at step 2" })).toHaveAttribute("aria-pressed", "true");
    expect(state.project.patterns[0]?.events).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 36, clientY: 15 });
    expect(state.project.patterns[0]?.events).toHaveLength(2);
    expect(state.history).toHaveLength(1);
  });

  it("maps pointer positions to step columns that fill a wider editor", () => {
    const grid = mount();
    const cells = grid.querySelector<HTMLElement>("[data-drum-cells]")!;
    vi.spyOn(cells, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 994, 90));
    expect(cells).toHaveStyle({ gridTemplateColumns: "repeat(16,minmax(24px,1fr))" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add Kick at step 1" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 218, clientY: 15 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 218, clientY: 15 });
    const pattern = state.project.patterns[0];
    expect(pattern?.kind).toBe("drum");
    if (pattern?.kind !== "drum") throw new Error("Expected a drum pattern");
    expect(pattern.events.map((event) => event.startStep)).toEqual([0, 3]);
  });

  it("uses the first cell state to erase a stroke", () => {
    const pattern: DrumPattern = { ...beat, events: [
      { id: "a", soundId: "kick", startStep: 0 }, { id: "b", soundId: "kick", startStep: 1 },
    ] };
    const grid = mount(pattern);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Remove Kick at step 1" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 36, clientY: 15 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 36, clientY: 15 });
    expect(state.project.patterns[0]?.events).toHaveLength(0);
    expect(state.history).toHaveLength(1);
  });

  it.each(["pointercancel", "escape", "lostcapture"])("cancels a paint preview on %s", (cancel) => {
    const grid = mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add Snare at step 1" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 45 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 36, clientY: 45 });
    expect(screen.getByRole("button", { name: "Remove Snare at step 2" })).toHaveAttribute("aria-pressed", "true");
    if (cancel === "pointercancel") fireEvent.pointerCancel(grid, { pointerId: 1 });
    if (cancel === "escape") fireEvent.keyDown(grid, { key: "Escape" });
    if (cancel === "lostcapture") fireEvent.lostPointerCapture(grid, { pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 36, clientY: 45 });
    expect(state.project.patterns[0]?.events).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });

  it("renders every step of a four-bar pattern from the catalog", () => {
    mount({ ...beat, lengthBars: 4 });
    expect(screen.getByRole("button", { name: "Add Hat at step 64" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(192);
  });

  it("discards an unfinished stroke when the pattern disappears", () => {
    mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add Kick at step 1" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 15 });
    act(() => state.deletePattern("beat"));
    expect(screen.queryByRole("region", { name: "Drum grid for Beat" })).not.toBeInTheDocument();
    expect(state.history).toHaveLength(1);
  });
});
