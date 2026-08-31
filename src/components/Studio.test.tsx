import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Studio } from "@/components/Studio";
import { Transport } from "@/components/Transport";
import { ActivityPanel } from "@/components/ActivityPanel";
import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (): void { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

describe("Studio", () => {
  it("opens track movement controls with the keyboard and cancels without history", async () => {
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    screen.getByRole("button", { name: "Reorder Neon Kit" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Move down" })).toBeVisible();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it.each([
    { instrumentId: "kit.basic", name: "Basic drums", incompatibleInstrument: "Bass" },
    { instrumentId: "synth.bass", name: "Bass", incompatibleInstrument: "Basic drums" },
  ])("creates $name from one instrument selector and undoes it", async ({ instrumentId, name, incompatibleInstrument }) => {
    const user = userEvent.setup();
    render(<Studio initialProject={EMPTY_PROJECT} />);
    await user.click(screen.getByRole("button", { name: "Add track" }));
    const selector = screen.getByRole("combobox", { name: "Instrument" });
    await user.selectOptions(selector, "synth.pad");
    await user.selectOptions(selector, instrumentId);
    expect(screen.queryByRole("group", { name: "Track type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create track" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Select track ${name}` })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: `Select track ${name}` })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("button", { name: `Select track ${name}` })).toBeVisible();
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/type cannot be changed/i);
    expect(screen.queryByRole("option", { name: incompatibleInstrument })).not.toBeInTheDocument();
  });

  it("renames, changes preset, and reorders a track in arrangement and mixer", async () => {
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await user.click(screen.getByRole("button", { name: "Edit Low Orbit" }));
    await user.clear(screen.getByLabelText("Track name"));
    await user.type(screen.getByLabelText("Track name"), "Sub bass");
    await user.click(screen.getByRole("button", { name: "Rename track" }));
    await user.selectOptions(screen.getByLabelText("Instrument"), "synth.pad");
    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close track settings" }));
    expect(screen.getAllByRole("button", { name: /Select track / })[0]).toHaveAccessibleName("Select track Sub bass");
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const mixer = within(screen.getByRole("region", { name: "Mixer channels" }));
    expect(mixer.getAllByRole("group")[0]).toHaveAccessibleName("Sub bass channel");
    expect(mixer.getAllByRole("group")[0]).toHaveTextContent("Pad");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(mixer.getAllByRole("group")[0]).toHaveAccessibleName("Neon Kit channel");
  });

  it("confirms affected clips before deleting a track and keeps reusable patterns", async () => {
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await user.click(screen.getByRole("button", { name: "Edit Neon Kit" }));
    await user.click(screen.getByRole("button", { name: "Delete track" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 clips");
    expect(screen.getByRole("dialog")).toHaveTextContent("Patterns remain");
    await user.click(screen.getByRole("button", { name: "Keep track" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete track" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.queryByRole("region", { name: "Neon Kit lane" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select pattern Neon beat" })).toHaveTextContent("Unplaced");
    expect(screen.getByRole("button", { name: "Add track" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("region", { name: "Neon Kit lane" })).toBeVisible();
  });

  it("selects shared clips and unplaced patterns using project content", async () => {
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await user.click(within(screen.getByRole("region", { name: "Glasshouse lane" })).getAllByRole("button", { name: "Select Glasshouse" })[1]!);
    expect(screen.getByRole("region", { name: "Pattern editor for Glasshouse" })).toHaveTextContent("2 placements");
    await user.click(screen.getByRole("button", { name: "Select pattern Unused idea" }));
    expect(screen.getByRole("region", { name: "Pattern editor for Unused idea" })).toHaveTextContent("Unplaced");
    expect(screen.getByRole("region", { name: "Pattern editor for Unused idea" })).not.toHaveTextContent("SELECTED TRACK");
  });

  it("renders empty sessions without assuming a track or pattern", () => {
    render(<Studio initialProject={EMPTY_PROJECT} />);
    expect(screen.getByText("Add a track to start arranging.")).toBeVisible();
    expect(screen.getByText("Select a pattern to view its notes or hits.")).toBeVisible();
  });

  it("renders exact project mixer values in project track order without simulated meters", async () => {
    const user = userEvent.setup();
    render(<Studio initialProject={{ ...DEMO_PROJECT, name: "Test song", bpm: 96,
      tracks: [...DEMO_PROJECT.tracks].reverse() }} />);
    expect(screen.getByText("Test song")).toBeVisible();
    expect(screen.getByLabelText("Project tempo")).toHaveTextContent("96");
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    const mixer = screen.getByRole("region", { name: "Mixer channels" });
    expect(within(mixer).getAllByRole("group").map((element) => element.getAttribute("aria-label")))
      .toEqual(["Night Air channel", "Afterglow channel", "Glasshouse channel", "Low Orbit channel", "Neon Kit channel", "Master channel"]);
    expect(screen.getByRole("slider", { name: "Neon Kit volume" })).toHaveValue("-6");
    expect(screen.getByRole("slider", { name: "Neon Kit pan" })).toHaveValue("0");
    expect(screen.queryByRole("slider", { name: "Master pan" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Master output level")).not.toBeInTheDocument();
  });

  it("toggles activity and editor panels without initializing audio", async () => {
    const context = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("AudioContext", context);
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<Studio initialProject={DEMO_PROJECT} />);
    await user.click(screen.getByRole("button", { name: "Hide activity" }));
    expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mixer" }));
    expect(screen.getByRole("region", { name: "Mixer channels" })).toBeVisible();
    expect(context).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("publishes history and undo/redo to the transport", async () => {
    let state: StudioState | undefined;
    function Probe(): null {
      state = useStudioStore((value) => value);
      return null;
    }
    const user = userEvent.setup();
    render(<StudioProvider initialProject={EMPTY_PROJECT}><Transport /><ActivityPanel /><Probe /></StudioProvider>);
    act(() => state!.dispatch({
      id: "rename", source: "agent", label: "Agent named song", kind: "operation",
      operation: { type: "project.update", changes: { name: "Named song" } },
    }));
    expect(screen.getByText("Named song")).toBeVisible();
    expect(screen.getByText("Agent named song")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Untitled")).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("Named song")).toBeVisible();
  });
});
