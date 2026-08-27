import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Studio } from "@/components/Studio";
import { useStudioStore } from "@/stores/studio-store";

describe("Studio", () => {
  beforeEach(() => {
    useStudioStore.setState(useStudioStore.getInitialState(), true);
  });

  it("controls playback", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    const play = screen.getByRole("button", { name: "Play" });
    await user.click(play);
    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles the activity overlay", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    expect(screen.getByRole("complementary", { name: "Activity" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide activity" }));
    expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("selects a clip and its pattern", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    await user.click(screen.getByRole("button", { name: "Select Afterglow" }));

    expect(screen.getByRole("button", { name: "Select Afterglow" })).toHaveAttribute("aria-pressed", "true");
    expect(useStudioStore.getState().selectedPatternId).toBe("afterglow");
  });

  it("shares mute and solo state from track controls", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    await user.click(screen.getAllByRole("button", { name: "Mute Neon Kit" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Solo Low Orbit" })[0]);

    expect(screen.getAllByRole("button", { name: "Unmute Neon Kit" })[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: "Unsolo Low Orbit" })[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("switches patterns and edits sequence steps", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    await user.click(screen.getByRole("button", { name: "Select pattern Afterglow" }));
    expect(screen.getByRole("region", { name: "Pattern editor for Afterglow" })).toBeVisible();

    const step = screen.getByRole("button", { name: "Add C5 at step 1" });
    await user.click(step);
    expect(step).toHaveAttribute("aria-pressed", "true");
  });

  it("changes editor tabs", async () => {
    const user = userEvent.setup();
    render(<Studio />);

    await user.click(screen.getByRole("button", { name: "Mixer" }));
    expect(screen.getByRole("button", { name: "Mixer" })).toHaveAttribute("aria-pressed", "true");
  });
});
