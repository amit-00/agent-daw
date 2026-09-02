import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { Clip } from "@/components/arrangement/Clip";
import { EMPTY_PROJECT } from "@/data/studio-data";
import type { ArrangementClip, Project, SynthPattern } from "@/project";
import { StudioProvider, type StudioPersistenceSession } from "@/stores/studio-provider";

const TEST_PERSISTENCE_SESSION: StudioPersistenceSession = {
  service: null,
  baseline: { status: "unsaved", updatedAt: null, errorMessage: null },
};

it("renders thin rounded MIDI notes within their occupied octaves", () => {
  const pattern: SynthPattern = { id: "phrase", name: "Phrase", kind: "synth", lengthBars: 1,
    events: [
      { id: "low", midiNote: 36, startStep: 0, lengthSteps: 2 },
      { id: "high", midiNote: 50, startStep: 4, lengthSteps: 2 },
    ] };
  const clip: ArrangementClip = { id: "clip", patternId: pattern.id, trackId: "track", startBar: 0, repeatCount: 1 };
  const project: Project = { ...EMPTY_PROJECT,
    tracks: [{ id: "track", name: "Track", kind: "synth", instrumentId: "synth.lead",
      volumeDb: 0, pan: 0, muted: false, soloed: false }],
    patterns: [pattern], arrangement: [clip] };

  const { container } = render(
    <StudioProvider initialProject={project} persistenceSession={TEST_PERSISTENCE_SESSION}>
      <Clip clip={clip} pattern={pattern} bars={16} onEdit={() => undefined} />
    </StudioProvider>,
  );

  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 16 24");
  expect(container.querySelector("svg pattern")).toHaveAttribute("height", "24");
  const notes = container.querySelectorAll("svg pattern rect");
  expect(notes[0]).toHaveAttribute("y", "23.2");
  expect(notes[0]).toHaveAttribute("height", "0.6");
  expect(notes[0]).toHaveAttribute("rx", "0.3");
  expect(notes[1]).toHaveAttribute("y", "9.2");
});
