import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import StudioPage from "@/app/page";

it("renders a silent in-memory workstation with no fabricated history", () => {
  render(<StudioPage />);
  expect(screen.getByRole("region", { name: "Song arrangement" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Track editor" })).toBeVisible();
  for (const name of ["Play", "Stop", "Record", "Loop playback", "Undo", "Redo"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  expect(screen.getByText(/silent.*in memory.*refresh/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Show activity" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
});
