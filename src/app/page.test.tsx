import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";

import StudioPage from "@/app/page";
import { useStudioStore } from "@/stores/studio-store";

beforeEach(() => {
  useStudioStore.setState(useStudioStore.getInitialState(), true);
});

it("renders the Zustand-backed workstation", async () => {
  const user = userEvent.setup();
  render(<StudioPage />);

  expect(screen.getByRole("region", { name: "Song arrangement" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Track editor" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Play" }));
  expect(useStudioStore.getState().isPlaying).toBe(true);
});
