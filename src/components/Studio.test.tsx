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
});
