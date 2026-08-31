import { expect, it } from "vitest";

import { DEMO_PROJECT, getTrackColor } from "@/data/studio-data";

it("keeps the original track palette attached to track identity after reordering", () => {
  expect(DEMO_PROJECT.tracks.map((track) => getTrackColor(track.id))).toEqual([
    "#9a69f5", "#d95fc8", "#ef6070", "#f18a4c", "#efbd52",
  ]);
  expect([...DEMO_PROJECT.tracks].reverse().map((track) => getTrackColor(track.id))).toEqual([
    "#efbd52", "#f18a4c", "#ef6070", "#d95fc8", "#9a69f5",
  ]);
  expect(getTrackColor("new-track")).toMatch(/^#[0-9a-f]{6}$/);
});
