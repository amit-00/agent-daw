import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Studio } from "@/components/Studio";
import { Transport } from "@/components/Transport";
import { ActivityPanel } from "@/components/ActivityPanel";
import { DEMO_PROJECT, EMPTY_PROJECT } from "@/data/studio-data";
import { StudioProvider, useStudioStore } from "@/stores/studio-provider";
import type { StudioState } from "@/stores/studio-store";

afterEach(() => vi.unstubAllGlobals());

describe("Studio", () => {
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
