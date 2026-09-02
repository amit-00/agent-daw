import { render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";

import StudioPage from "@/app/page";

afterEach(() => vi.unstubAllGlobals());

it("renders a workstation with no fabricated history after storage bootstrap", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  render(<StudioPage />);
  expect(await screen.findByRole("region", { name: "Song arrangement" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Track editor" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  for (const name of ["Stop", "Record", "Loop playback", "Undo", "Redo"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  expect(screen.getByText(/Audio ready.*Not saved yet/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Show activity" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("complementary", { name: "Activity" })).not.toBeInTheDocument();
});
