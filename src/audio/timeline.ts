import type { Project } from "../project/index.ts";

export interface DrumTimelineEvent {
  readonly key: string;
  readonly kind: "drum";
  readonly trackId: string;
  readonly instrumentId: string;
  readonly startStep: number;
  readonly soundId: string;
}

export interface SynthTimelineEvent {
  readonly key: string;
  readonly kind: "synth";
  readonly trackId: string;
  readonly instrumentId: string;
  readonly startStep: number;
  readonly durationSteps: number;
  readonly midiNote: number;
}

export type TimelineEvent = DrumTimelineEvent | SynthTimelineEvent;
export type TimelineIssueCode = "missing_pattern" | "missing_track" | "invalid_window";

export interface TimelineIssue {
  readonly code: TimelineIssueCode;
  readonly message: string;
  readonly relatedId?: string;
}

export interface TimelineExpansion {
  readonly events: readonly TimelineEvent[];
  readonly issues: readonly TimelineIssue[];
}

interface OrderedTimelineEvent {
  readonly event: TimelineEvent;
  readonly trackIndex: number;
  readonly patternEventIndex: number;
}

export const secondsPerStep = (bpm: number): number => {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new RangeError(`BPM must be a finite number from 40 through 240; received ${bpm}`);
  }
  return 60 / bpm / 4;
};

export const positionAtAudioTime = (
  anchorStep: number,
  anchorAudioTime: number,
  audioTime: number,
  bpm: number,
): number => Math.max(
  anchorStep,
  anchorStep + (audioTime - anchorAudioTime) / secondsPerStep(bpm),
);

export const audioTimeForStep = (
  step: number,
  anchorStep: number,
  anchorAudioTime: number,
  bpm: number,
): number => anchorAudioTime + (step - anchorStep) * secondsPerStep(bpm);

export const arrangementEndStep = (project: Project): number => {
  const patterns = new Map(project.patterns.map((pattern) => [pattern.id, pattern]));
  return project.arrangement.reduce((end, clip) => {
    const pattern = patterns.get(clip.patternId);
    return pattern === undefined
      ? end
      : Math.max(end, clip.startBar * 16 + pattern.lengthBars * 16 * clip.repeatCount);
  }, 0);
};

export const playbackFingerprint = (project: Project): string =>
  JSON.stringify([
    project.bpm,
    project.tracks.map(({ id, kind, instrumentId }) => ({ id, kind, instrumentId })),
    project.patterns,
    project.arrangement,
  ]);

export const expandTimeline = (
  project: Project,
  startStep: number,
  endStep: number,
): TimelineExpansion => {
  if (
    !Number.isFinite(startStep) ||
    !Number.isFinite(endStep) ||
    startStep < 0 ||
    endStep <= startStep
  ) {
    return {
      events: [],
      issues: [{ code: "invalid_window", message: "Timeline window must be finite, non-negative, and increasing" }],
    };
  }

  const patterns = new Map(project.patterns.map((pattern) => [pattern.id, pattern]));
  const tracks = new Map(project.tracks.map((track, index) => [track.id, { track, index }]));
  const events: OrderedTimelineEvent[] = [];
  const issues: TimelineIssue[] = [];

  for (const clip of project.arrangement) {
    const pattern = patterns.get(clip.patternId);
    if (pattern === undefined) {
      issues.push({
        code: "missing_pattern",
        message: "Arrangement clip references a missing pattern",
        relatedId: clip.patternId,
      });
      continue;
    }

    const trackEntry = tracks.get(pattern.trackId);
    if (trackEntry === undefined) {
      issues.push({
        code: "missing_track",
        message: "Pattern references a missing track",
        relatedId: pattern.trackId,
      });
      continue;
    }

    const patternSteps = pattern.lengthBars * 16;
    for (let repeatIndex = 0; repeatIndex < clip.repeatCount; repeatIndex += 1) {
      const repeatStart = clip.startBar * 16 + repeatIndex * patternSteps;
      if (pattern.kind === "drum") {
        for (const [patternEventIndex, event] of pattern.events.entries()) {
          if (event.startStep < 0 || event.startStep >= patternSteps) {
            continue;
          }
          const globalStart = repeatStart + event.startStep;
          if (globalStart >= startStep && globalStart < endStep) {
            events.push({
              event: {
                key: `${clip.id}:${repeatIndex}:${event.id}`,
                kind: "drum",
                trackId: trackEntry.track.id,
                instrumentId: trackEntry.track.instrumentId,
                startStep: globalStart,
                soundId: event.soundId,
              },
              trackIndex: trackEntry.index,
              patternEventIndex,
            });
          }
        }
        continue;
      }

      for (const [patternEventIndex, event] of pattern.events.entries()) {
        if (
          event.startStep < 0 ||
          event.lengthSteps <= 0 ||
          event.startStep + event.lengthSteps > patternSteps
        ) {
          continue;
        }
        const globalStart = repeatStart + event.startStep;
        const globalEnd = globalStart + event.lengthSteps;
        if (globalEnd > startStep && globalStart < endStep) {
          const emittedStart = Math.max(globalStart, startStep);
          events.push({
            event: {
              key: `${clip.id}:${repeatIndex}:${event.id}`,
              kind: "synth",
              trackId: trackEntry.track.id,
              instrumentId: trackEntry.track.instrumentId,
              startStep: emittedStart,
              durationSteps: globalEnd - emittedStart,
              midiNote: event.midiNote,
            },
            trackIndex: trackEntry.index,
            patternEventIndex,
          });
        }
      }
    }
  }

  events.sort(
    (left, right) =>
      left.event.startStep - right.event.startStep ||
      left.trackIndex - right.trackIndex ||
      left.patternEventIndex - right.patternEventIndex,
  );
  return { events: events.map(({ event }) => event), issues };
};
