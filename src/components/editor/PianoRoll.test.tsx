import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PianoRoll } from "@/components/editor/PianoRoll";
import { PatternEditor } from "@/components/editor/PatternEditor";
import { EMPTY_PROJECT } from "@/data/studio-data";
import type { Project, SynthPattern } from "@/project";
import { StudioProvider, useStudioStore, type StudioPersistenceSession } from "@/stores/studio-provider";
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

function Harness({ patternId }: Readonly<{ patternId: string }>): ReactElement | null {
  const pattern = useStudioStore((value) => value.project.patterns.find((item) => item.id === patternId));
  return pattern?.kind === "synth" ? <PianoRoll pattern={pattern} /> : null;
}

function mount(pattern: SynthPattern = melody): { roll: HTMLElement; cells: HTMLElement } {
  const project: Project = { ...EMPTY_PROJECT, patterns: [pattern] };
  render(<StudioProvider initialProject={project} persistenceSession={TEST_PERSISTENCE_SESSION}><Harness patternId={pattern.id} /><Probe /></StudioProvider>);
  const roll = screen.getByRole("region", { name: `Piano roll for ${pattern.name}` });
  const cells = roll.querySelector<HTMLElement>("[data-piano-cells]")!;
  Object.defineProperties(cells, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  vi.spyOn(cells, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, pattern.lengthBars * 384, 73 * 18));
  return { roll, cells };
}

function selectNote(cells: HTMLElement, name: string, pointerId: number, shiftKey = false): HTMLElement {
  const note = screen.getByRole("button", { name });
  fireEvent.pointerDown(note, { pointerId, button: 0, clientX: 12, clientY: 657, shiftKey });
  fireEvent.pointerUp(cells, { pointerId, clientX: 12, clientY: 657 });
  return note;
}

function selectedNoteIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-note-id][aria-pressed='true']"), (note) => note.dataset.noteId!);
}

beforeEach(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PianoRoll", () => {
  it("keeps the 73-row grid stable and replaces raw controls with a contextual musical inspector", () => {
    const { roll, cells } = mount();
    const inspectorSlot = roll.querySelector<HTMLElement>("[data-note-inspector]")!;
    expect(inspectorSlot).toBeEmptyDOMElement();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate selected" })).not.toBeInTheDocument();
    expect(screen.getByText("C7")).toBeVisible();
    expect(screen.getByText("C1")).toBeVisible();

    selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    const inspector = screen.getByRole("status", { name: "Selected note inspector" });
    expect(inspector).toHaveTextContent("1 note selected");
    expect(inspector).toHaveTextContent("Pitch C4");
    expect(inspector).toHaveTextContent("Position Bar 1 · Beat 1 · Step 1");
    expect(inspector).toHaveTextContent("Duration 1/4 note");
    expect(roll.querySelector("[data-piano-cells]")).toBe(cells);
    expect(roll.querySelector("[data-note-inspector]")).toBe(inspectorSlot);

    selectNote(cells, "Select E4 at step 5 for 2 steps", 2, true);
    expect(inspector).toHaveTextContent("2 notes selected");
    expect(within(inspector).getAllByText("Mixed")).toHaveLength(2);
    expect(inspector).toHaveTextContent("Bar 1 · Beat 1 · Step 1 – Bar 1 · Beat 2 · Step 1");
  });

  it("single-selects, Shift-toggles, and clears selection from an empty click", () => {
    const { cells } = mount();
    selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(cells, "Select E4 at step 5 for 2 steps", 2, true);
    expect(selectedNoteIds()).toEqual(["a", "b"]);
    selectNote(cells, "Select C4 at step 1 for 4 steps", 3, true);
    expect(selectedNoteIds()).toEqual(["b"]);
    fireEvent.pointerDown(cells, { pointerId: 4, button: 0, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(cells, { pointerId: 4, clientX: 300, clientY: 100 });
    expect(selectedNoteIds()).toEqual([]);
    expect(state.history).toHaveLength(0);
  });

  it("marquee-selects notes intersecting a drag from empty grid space", () => {
    const { cells } = mount();
    fireEvent.pointerDown(cells, { pointerId: 1, button: 0, clientX: 150, clientY: 570 });
    fireEvent.pointerMove(cells, { pointerId: 1, clientX: 0, clientY: 670 });
    expect(screen.getByTestId("note-marquee")).toBeVisible();
    expect(selectedNoteIds()).toEqual(["a", "b"]);
    fireEvent.pointerUp(cells, { pointerId: 1, clientX: 0, clientY: 670 });
    expect(screen.queryByTestId("note-marquee")).not.toBeInTheDocument();
    expect(state.history).toHaveLength(0);
  });

  it("moves a selected group with one snapped bounded delta and commits once", () => {
    const { cells } = mount();
    selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(cells, "Select E4 at step 5 for 2 steps", 2, true);
    const note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    fireEvent.pointerDown(note, { pointerId: 3, button: 0, clientX: 12, clientY: 657 });
    fireEvent.pointerMove(cells, { pointerId: 3, clientX: 36, clientY: 639 });
    expect(screen.getByRole("button", { name: "Select C♯4 at step 2 for 4 steps" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Select F4 at step 6 for 2 steps" })).toBeVisible();
    expect(state.project.patterns[0]?.events).toEqual(melody.events);
    fireEvent.pointerUp(cells, { pointerId: 3, clientX: 36, clientY: 639 });
    expect(state.project.patterns[0]?.events).toMatchObject([
      { midiNote: 61, startStep: 1, lengthSteps: 4 },
      { midiNote: 65, startStep: 5, lengthSteps: 2 },
    ]);
    expect(state.history).toHaveLength(1);
  });

  it("resizes the selected group from either invisible seven-pixel edge", () => {
    const mounted = mount();
    selectNote(mounted.cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(mounted.cells, "Select E4 at step 5 for 2 steps", 2, true);
    let note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    const right = note.querySelector<HTMLElement>("[data-resize-side='right']")!;
    expect(right).toHaveClass("w-[7px]", "inset-y-[-1px]");
    fireEvent.pointerDown(right, { pointerId: 3, button: 0, clientX: 96, clientY: 657 });
    fireEvent.pointerMove(mounted.cells, { pointerId: 3, clientX: 144, clientY: 657 });
    fireEvent.pointerUp(mounted.cells, { pointerId: 3, clientX: 144, clientY: 657 });
    expect(state.project.patterns[0]?.events).toMatchObject([{ lengthSteps: 6 }, { lengthSteps: 4 }]);
    expect(state.history).toHaveLength(1);

    act(() => state.undo());
    note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    const left = note.querySelector<HTMLElement>("[data-resize-side='left']")!;
    fireEvent.pointerDown(left, { pointerId: 4, button: 0, clientX: 0, clientY: 657 });
    fireEvent.pointerMove(mounted.cells, { pointerId: 4, clientX: 72, clientY: 657 });
    fireEvent.pointerUp(mounted.cells, { pointerId: 4, clientX: 72, clientY: 657 });
    expect(state.project.patterns[0]?.events).toMatchObject([
      { startStep: 1, lengthSteps: 3 }, { startStep: 5, lengthSteps: 1 },
    ]);
  });

  it("double-clicks empty space to create and a note to delete without hijacking right-click", () => {
    const { cells } = mount({ ...melody, events: [] });
    fireEvent.doubleClick(cells, { clientX: 60, clientY: 621 });
    const created = screen.getByRole("button", { name: "Select D4 at step 3 for 1 step" });
    expect(created).toHaveAttribute("aria-pressed", "true");
    expect(state.history).toHaveLength(1);
    expect(fireEvent.contextMenu(created)).toBe(true);
    fireEvent.doubleClick(created);
    expect(screen.queryByRole("button", { name: "Select D4 at step 3 for 1 step" })).not.toBeInTheDocument();
    expect(state.history).toHaveLength(2);
  });

  it("duplicates only after an Option-drag crosses its threshold, then moves and selects the copies", () => {
    const { cells } = mount();
    selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(cells, "Select E4 at step 5 for 2 steps", 2, true);
    let note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    fireEvent.pointerDown(note, { pointerId: 3, button: 0, clientX: 12, clientY: 657, altKey: true });
    fireEvent.pointerUp(cells, { pointerId: 3, clientX: 12, clientY: 657, altKey: true });
    expect(state.project.patterns[0]?.events).toHaveLength(2);
    expect(state.history).toHaveLength(0);

    note = screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" });
    fireEvent.pointerDown(note, { pointerId: 4, button: 0, clientX: 12, clientY: 657, altKey: true });
    fireEvent.pointerMove(cells, { pointerId: 4, clientX: 36, clientY: 639, altKey: true });
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(4);
    expect(state.project.patterns[0]?.events).toHaveLength(2);
    fireEvent.pointerUp(cells, { pointerId: 4, clientX: 36, clientY: 639, altKey: true });
    const events = state.project.patterns[0]?.events ?? [];
    expect(events).toHaveLength(4);
    expect(events.slice(2)).toMatchObject([
      { midiNote: 61, startStep: 1, lengthSteps: 4 },
      { midiNote: 65, startStep: 5, lengthSteps: 2 },
    ]);
    expect(selectedNoteIds()).toEqual(events.slice(2).map((event) => event.id));
    expect(state.history).toHaveLength(1);
  });

  it("moves selections with snapped arrows and preserves the group at shared boundaries", () => {
    let mounted = mount();
    selectNote(mounted.cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(mounted.cells, "Select E4 at step 5 for 2 steps", 2, true);
    fireEvent.keyDown(mounted.roll, { key: "ArrowRight" });
    fireEvent.keyDown(mounted.roll, { key: "ArrowUp" });
    fireEvent.keyDown(mounted.roll, { key: "ArrowLeft", metaKey: true });
    expect(state.project.patterns[0]?.events).toMatchObject([
      { midiNote: 61, startStep: 0 }, { midiNote: 65, startStep: 4 },
    ]);
    expect(state.history).toHaveLength(3);

    cleanup();
    mounted = mount({ ...melody, events: [
      { id: "a", midiNote: 24, startStep: 0, lengthSteps: 2 },
      { id: "b", midiNote: 96, startStep: 14, lengthSteps: 2 },
    ] });
    selectNote(mounted.cells, "Select C1 at step 1 for 2 steps", 4);
    selectNote(mounted.cells, "Select C7 at step 15 for 2 steps", 5, true);
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) fireEvent.keyDown(mounted.roll, { key });
    expect(state.project.patterns[0]?.events).toMatchObject([
      { midiNote: 24, startStep: 0 }, { midiNote: 96, startStep: 14 },
    ]);
    expect(state.history).toHaveLength(0);
  });

  it("duplicates after the occupied span and reports when the selection cannot fit", () => {
    let mounted = mount();
    selectNote(mounted.cells, "Select C4 at step 1 for 4 steps", 1);
    selectNote(mounted.cells, "Select E4 at step 5 for 2 steps", 2, true);
    fireEvent.keyDown(mounted.roll, { key: "d", metaKey: true });
    let events = state.project.patterns[0]?.events ?? [];
    expect(events.slice(2)).toMatchObject([{ startStep: 6 }, { startStep: 10 }]);
    expect(selectedNoteIds()).toEqual(events.slice(2).map((event) => event.id));
    expect(state.history).toHaveLength(1);

    cleanup();
    mounted = mount({ ...melody, events: [{ id: "edge", midiNote: 60, startStep: 12, lengthSteps: 4 }] });
    selectNote(mounted.cells, "Select C4 at step 13 for 4 steps", 3);
    fireEvent.keyDown(mounted.roll, { key: "d", ctrlKey: true });
    events = state.project.patterns[0]?.events ?? [];
    expect(events).toHaveLength(1);
    expect(state.history).toHaveLength(0);
    expect(state.errorMessage).toMatch(/past step 16/i);
  });

  it("deletes with Delete or Backspace and clears with Escape", () => {
    const { roll, cells } = mount();
    selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    fireEvent.keyDown(roll, { key: "Escape" });
    expect(selectedNoteIds()).toEqual([]);
    selectNote(cells, "Select C4 at step 1 for 4 steps", 2);
    fireEvent.keyDown(roll, { key: "Backspace" });
    expect(state.project.patterns[0]?.events).toHaveLength(1);
    expect(state.history).toHaveLength(1);
  });

  it.each(["pointercancel", "lostcapture", "escape"])("cancels a group preview on %s without committing", (cancel) => {
    const { roll, cells } = mount({ ...melody, events: [melody.events[0]!] });
    const note = selectNote(cells, "Select C4 at step 1 for 4 steps", 1);
    fireEvent.pointerDown(note, { pointerId: 2, button: 0, clientX: 12, clientY: 657 });
    fireEvent.pointerMove(cells, { pointerId: 2, clientX: 36, clientY: 639 });
    if (cancel === "pointercancel") fireEvent.pointerCancel(cells, { pointerId: 2 });
    if (cancel === "lostcapture") fireEvent.lostPointerCapture(cells, { pointerId: 2 });
    if (cancel === "escape") fireEvent.keyDown(roll, { key: "Escape" });
    expect(state.project.patterns[0]?.events).toEqual([melody.events[0]!]);
    expect(state.history).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Select C♯4 at step 2 for 4 steps" })).not.toBeInTheDocument();
  });

  it("renders step 64 and discards a gesture when its pattern disappears", () => {
    const long = { ...melody, lengthBars: 4 as const, events: [melody.events[0]!] };
    const { cells } = mount(long);
    expect(screen.getByRole("group", { name: "Note grid, 64 steps" })).toBeVisible();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Select C4 at step 1 for 4 steps" }),
      { pointerId: 1, button: 0, clientX: 12, clientY: 657 });
    act(() => state.deletePattern("melody"));
    expect(screen.queryByRole("region", { name: "Piano roll for Melody" })).not.toBeInTheDocument();
    expect(cells.isConnected).toBe(false);
  });

  it("replaces the prototype synth view in the pattern editor", () => {
    render(<StudioProvider initialProject={{ ...EMPTY_PROJECT, patterns: [melody] }} persistenceSession={TEST_PERSISTENCE_SESSION}><PatternEditor /></StudioProvider>);
    expect(screen.getByRole("region", { name: "Piano roll for Melody" })).toBeVisible();
    expect(screen.queryByTitle("Piano-roll editing is not connected yet")).not.toBeInTheDocument();
  });
});
