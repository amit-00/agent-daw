import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PianoRoll } from "@/components/editor/PianoRoll";
import { PatternEditor } from "@/components/editor/PatternEditor";
import { EMPTY_PROJECT } from "@/data/studio-data";
import type { Project, SynthPattern } from "@/project";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const melody: SynthPattern = { id: "melody", name: "Melody", kind: "synth", lengthBars: 1, events: [
  { id: "a", midiNote: 60, startStep: 0, lengthSteps: 4 },
  { id: "b", midiNote: 64, startStep: 4, lengthSteps: 2 },
] };
let state: StudioState;

function Probe(): null {
  const snapshot = useStudioStore((value) => value);
  useEffect(() => { state = snapshot; }, [snapshot]);
  return null;
}

function Harness({ patternId }: Readonly<{ patternId: string }>): React.ReactElement | null {
  const pattern = useStudioStore((value) => value.project.patterns.find((item) => item.id === patternId));
  return pattern?.kind === "synth" ? <PianoRoll pattern={pattern} /> : null;
}

function mount(pattern: SynthPattern = melody): HTMLElement {
  const project: Project = { ...EMPTY_PROJECT, patterns: [pattern] };
  render(<StudioProvider initialProject={project}><Harness patternId={pattern.id} /><Probe /></StudioProvider>);
  const roll = screen.getByRole("region", { name: `Piano roll for ${pattern.name}` });
  Object.defineProperties(roll, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  const cells = roll.querySelector<HTMLElement>("[data-piano-cells]")!;
  vi.spyOn(cells, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, pattern.lengthBars * 384, 73 * 18));
  return roll;
}

function selectNote(roll: HTMLElement, name: string, pointerId: number, shiftKey = false): void {
  const note = screen.getByRole("button", { name });
  fireEvent.pointerDown(note, { pointerId, button: 0, clientX: 12, clientY: 657, shiftKey });
  fireEvent.pointerUp(roll, { pointerId, clientX: 12, clientY: 657 });
}

function clickCell(roll: HTMLElement, midiNote: number, startStep: number): void {
  const cells = roll.querySelector<HTMLElement>("[data-piano-cells]")!;
  fireEvent.click(cells, { clientX: startStep * 24 + 12, clientY: (96 - midiNote) * 18 + 9 });
}

beforeEach(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PianoRoll", () => {
  it("renders chromatic pitches and note position and duration", () => {
    const roll = mount();
    const scrollingGrid = roll.querySelector("[data-piano-scroll]");
    expect(scrollingGrid).toContainElement(screen.getByRole("group", { name: "Note grid, 16 steps" }));
    expect(scrollingGrid).not.toContainElement(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("C7")).toBeVisible();
    expect(screen.getByText("C1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" }))
      .toHaveStyle({ gridColumn: "1 / span 4", gridRow: "37" });
  });

  it("creates a one-step note by clicking an empty cell", () => {
    const roll = mount({ ...melody, events: [] });
    clickCell(roll, 60, 2);
    expect(screen.getByRole("button", { name: "Select C4 at step 3 for 1 step" })).toBeVisible();
    expect(state.project.patterns[0]?.events).toHaveLength(1);
    expect(state.history).toHaveLength(1);
  });

  it("creates a note with the labeled numeric controls", () => {
    mount({ ...melody, events: [] });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Pitch" }), { target: { value: "62" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Start step" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByRole("button", { name: "Select D4 at step 3 for 2 steps" })).toBeVisible();
    expect(state.history).toHaveLength(1);
  });

  it("selects one note and Shift-selects another without history", () => {
    const roll = mount();
    selectNote(roll, "Select C4 at step 1 for 4 steps", 1);
    selectNote(roll, "Select E4 at step 5 for 2 steps", 2, true);
    expect(screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select E4 at step 5 for 2 steps" })).toHaveAttribute("aria-pressed", "true");
    expect(state.history).toHaveLength(0);
  });

  it("previews a snapped selection move and commits it once", () => {
    const roll = mount({ ...melody, events: [melody.events[0]!] });
    const note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 12, clientY: 657 });
    fireEvent.pointerMove(roll, { pointerId: 1, clientX: 36, clientY: 639 });
    expect(screen.getByRole("button", { name: "Select C♯4 at step 2 for 4 steps" })).toBeVisible();
    expect(state.project.patterns[0]?.events[0]).toMatchObject({ midiNote: 60, startStep: 0 });
    expect(state.history).toHaveLength(0);
    fireEvent.pointerUp(roll, { pointerId: 1, clientX: 36, clientY: 639 });
    expect(state.project.patterns[0]?.events[0]).toMatchObject({ midiNote: 61, startStep: 1 });
    expect(state.history).toHaveLength(1);
  });

  it("cancels a resize preview and commits a later resize once", () => {
    const roll = mount({ ...melody, events: [melody.events[0]!] });
    const handle = screen.getByRole("button", { name: "Resize C4 at step 1" });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 96, clientY: 657 });
    fireEvent.pointerMove(roll, { pointerId: 1, clientX: 144, clientY: 657 });
    expect(screen.getByRole("button", { name: "Select C4 at step 1 for 6 steps" })).toBeVisible();
    fireEvent.pointerCancel(roll, { pointerId: 1 });
    expect(state.project.patterns[0]?.events[0]).toMatchObject({ lengthSteps: 4 });
    expect(state.history).toHaveLength(0);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize C4 at step 1" }),
      { pointerId: 2, button: 0, clientX: 96, clientY: 657 });
    fireEvent.pointerMove(roll, { pointerId: 2, clientX: 144, clientY: 657 });
    fireEvent.pointerUp(roll, { pointerId: 2, clientX: 144, clientY: 657 });
    expect(state.project.patterns[0]?.events[0]).toMatchObject({ lengthSteps: 6 });
    expect(state.history).toHaveLength(1);
  });

  it("applies labeled controls and ignores Delete inside a number field", () => {
    const roll = mount({ ...melody, events: [melody.events[0]!] });
    selectNote(roll, "Select C4 at step 1 for 4 steps", 1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Pitch" }), { target: { value: "62" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Start step" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Length" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply note" }));
    const edited = screen.getByRole("button", { name: "Select D4 at step 3 for 2 steps" });
    expect(state.project.patterns[0]?.events[0]).toMatchObject({ midiNote: 62, startStep: 2, lengthSteps: 2 });
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Pitch" }), { key: "Delete" });
    expect(state.project.patterns[0]?.events).toHaveLength(1);
    fireEvent.keyDown(edited, { key: "Delete" });
    expect(state.project.patterns[0]?.events).toHaveLength(0);
    expect(state.history).toHaveLength(2);
  });

  it("duplicates the selected notes by the explicit offset", () => {
    const roll = mount();
    selectNote(roll, "Select C4 at step 1 for 4 steps", 1);
    selectNote(roll, "Select E4 at step 5 for 2 steps", 2, true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Duplicate offset" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate selected" }));
    const events = state.project.patterns[0]?.events ?? [];
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.id)).size).toBe(4);
    expect(events.slice(2)).toMatchObject([{ startStep: 2 }, { startStep: 6 }]);
    expect(state.history).toHaveLength(1);
  });

  it("renders step 64 and discards a gesture when its pattern disappears", () => {
    const long = { ...melody, lengthBars: 4 as const, events: [melody.events[0]!] };
    mount(long);
    expect(screen.getByRole("group", { name: "Note grid, 64 steps" })).toBeVisible();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 657 });
    act(() => state.deletePattern("melody"));
    expect(screen.queryByRole("region", { name: "Piano roll for Melody" })).not.toBeInTheDocument();
    expect(state.history).toHaveLength(1);
  });

  it("replaces the prototype synth view in the pattern editor", () => {
    render(<StudioProvider initialProject={{ ...EMPTY_PROJECT, patterns: [melody] }}><PatternEditor /></StudioProvider>);
    expect(screen.getByRole("region", { name: "Piano roll for Melody" })).toBeVisible();
    expect(screen.queryByTitle("Piano-roll editing is not connected yet")).not.toBeInTheDocument();
  });
});
