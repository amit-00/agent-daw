import type { Project, Track } from "../project/index.ts";
import { BASIC_DRUM_KIT, SYNTH_PRESETS } from "./catalog.ts";
import type { DrumSource, LoadArrayBuffer, Sampler } from "./sampler.ts";
import { createSampler } from "./sampler.ts";
import type { Synth, SynthVoice } from "./synth.ts";
import { createSynth } from "./synth.ts";
import {
  arrangementEndStep,
  audioTimeForStep,
  expandTimeline,
  playbackFingerprint,
  positionAtAudioTime,
  secondsPerStep,
} from "./timeline.ts";

export type AudioEngineStatus = "stopped" | "playing" | "paused" | "blocked" | "closed";
export type AudioIssueCode =
  | "missing_sample"
  | "missing_pattern"
  | "missing_track"
  | "unknown_preset"
  | "late_scheduler"
  | "source_failed";

export interface AudioIssue {
  readonly code: AudioIssueCode;
  readonly message: string;
  readonly relatedId?: string;
}

export interface AudioEngineSnapshot {
  readonly status: AudioEngineStatus;
  readonly positionStep: number;
  readonly arrangementEndStep: number;
  readonly unavailableSoundIds: readonly string[];
  readonly activeVoices: number;
  readonly pendingSources: number;
  readonly lateWakeups: number;
  readonly trackBusCount: number;
  readonly lastIssue?: AudioIssue;
}

export type PrepareResult =
  | { readonly ok: true; readonly status: "ready" | "degraded"; readonly unavailableSoundIds: readonly string[] }
  | { readonly ok: false; readonly code: "blocked" | "closed"; readonly message: string };

export type AudioControlResult =
  | {
      readonly ok: true;
      readonly status: "playing" | "paused" | "stopped";
      readonly positionStep: number;
    }
  | {
      readonly ok: false;
      readonly code: "blocked" | "closed" | "nothing_to_play" | "no_project";
      readonly message: string;
    };

export interface AudioEnginePlatform {
  readonly createContext: () => AudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
  readonly setInterval: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface AudioEngine {
  prepare(): Promise<PrepareResult>;
  replaceProject(project: Project): void;
  play(startStep: number): Promise<AudioControlResult>;
  pause(): AudioControlResult;
  seek(step: number): AudioControlResult;
  stop(): AudioControlResult;
  getSnapshot(): AudioEngineSnapshot;
  dispose(): Promise<void>;
}

interface TrackBus {
  readonly gain: GainNode;
  readonly panner: StereoPannerNode;
}

interface RetainedSource {
  readonly generation: number;
  readonly trackId: string;
  readonly source: DrumSource | SynthVoice;
}

const MIXER_RAMP_SECONDS = 0.005;
const PLAYBACK_START_LEAD_SECONDS = 0.05;
const SCHEDULER_LOOKAHEAD_SECONDS = 0.1;
const SCHEDULER_TICK_MILLISECONDS = 25;
const dbToGain = (decibels: number): number => 10 ** (decibels / 20);
const isAutoplayPolicyError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "NotAllowedError";

export function createAudioEngine(platform: AudioEnginePlatform): AudioEngine {
  let context: AudioContext | undefined;
  let sampler: Sampler | undefined;
  let synth: Synth | undefined;
  let master: GainNode | undefined;
  let project: Project | undefined;
  let projectFingerprint = "";
  let projectArrangementEndStep = 0;
  let status: AudioEngineStatus = "stopped";
  let unavailableSoundIds: readonly string[] = [];
  let lastIssue: AudioIssue | undefined;
  let preparation: Promise<PrepareResult> | undefined;
  let disposal: Promise<void> | undefined;
  let positionStep = 0;
  let anchorStep = 0;
  let anchorAudioTime = 0;
  let generation = 0;
  let playIntentRevision = 0;
  let scheduledHorizonAudioTime: number | undefined;
  let schedulerTimer: { readonly handle: unknown } | undefined;
  let lateWakeups = 0;
  const trackBuses = new Map<string, TrackBus>();
  const pendingSources = new Map<string, RetainedSource>();

  const clampStep = (step: number): number => Math.min(
    Math.max(Number.isNaN(step) ? 0 : step, 0),
    projectArrangementEndStep,
  );

  const currentPositionStep = (): number => {
    if (status !== "playing" || context === undefined || project === undefined) {
      return positionStep;
    }
    return clampStep(positionAtAudioTime(anchorStep, anchorAudioTime, context.currentTime, project.bpm));
  };

  const clearSchedulerTimer = (): void => {
    if (schedulerTimer === undefined) {
      return;
    }
    platform.clearInterval(schedulerTimer.handle);
    schedulerTimer = undefined;
  };

  const stopPendingSources = (audioTime: number): void => {
    for (const { source } of pendingSources.values()) {
      source.stop(audioTime);
    }
    pendingSources.clear();
  };

  const cancelPlayback = (): void => {
    clearSchedulerTimer();
    scheduledHorizonAudioTime = undefined;
    if (context !== undefined) {
      stopPendingSources(context.currentTime);
    } else {
      pendingSources.clear();
    }
  };

  const stopTrackSources = (trackId: string, audioTime: number): void => {
    for (const [eventKey, retained] of pendingSources) {
      if (retained.trackId !== trackId) {
        continue;
      }
      retained.source.stop(audioTime);
      pendingSources.delete(eventKey);
    }
  };

  const ramp = (parameter: AudioParam, value: number): void => {
    const currentTime = context?.currentTime;
    if (currentTime === undefined) {
      return;
    }
    parameter.cancelAndHoldAtTime(currentTime);
    parameter.linearRampToValueAtTime(value, currentTime + MIXER_RAMP_SECONDS);
  };

  const targetGain = (track: Track, hasSolo: boolean): number =>
    track.muted || (hasSolo && !track.soloed) ? 0 : dbToGain(track.volumeDb);

  const synchronizeMixer = (): void => {
    if (context === undefined || master === undefined || project === undefined) {
      return;
    }

    const currentTrackIds = new Set(project.tracks.map(({ id }) => id));
    for (const [trackId, bus] of trackBuses) {
      if (currentTrackIds.has(trackId)) {
        continue;
      }
      synth?.stopTrack(trackId, context.currentTime);
      stopTrackSources(trackId, context.currentTime);
      bus.gain.disconnect();
      bus.panner.disconnect();
      trackBuses.delete(trackId);
    }

    const hasSolo = project.tracks.some(({ soloed }) => soloed);
    ramp(master.gain, dbToGain(project.masterVolumeDb));
    for (const track of project.tracks) {
      let bus = trackBuses.get(track.id);
      if (bus === undefined) {
        const gain = context.createGain();
        const panner = context.createStereoPanner();
        gain.connect(panner);
        panner.connect(master);
        bus = { gain, panner };
        trackBuses.set(track.id, bus);
      }
      ramp(bus.gain.gain, targetGain(track, hasSolo));
      ramp(bus.panner.pan, track.pan);
    }
  };

  const initializeRuntime = (): void => {
    if (context !== undefined) {
      return;
    }
    context = platform.createContext();
    master = context.createGain();
    master.connect(context.destination);
    sampler = createSampler({
      context,
      kit: BASIC_DRUM_KIT,
      loadArrayBuffer: platform.loadArrayBuffer,
    });
    synth = createSynth({
      context,
      presets: SYNTH_PRESETS,
      voiceCap: 64,
      stopRampSeconds: MIXER_RAMP_SECONDS,
    });
  };

  const scheduleRange = (startStep: number, endStep: number): void => {
    if (
      project === undefined ||
      context === undefined ||
      sampler === undefined ||
      synth === undefined ||
      endStep <= startStep
    ) {
      return;
    }

    const expansion = expandTimeline(project, startStep, endStep);
    for (const issue of expansion.issues) {
      if (issue.code === "missing_pattern" || issue.code === "missing_track") {
        lastIssue = {
          code: issue.code,
          message: issue.message,
          ...(issue.relatedId === undefined ? {} : { relatedId: issue.relatedId }),
        };
      }
    }

    for (const event of expansion.events) {
      if (pendingSources.get(event.key)?.generation === generation) {
        continue;
      }
      const bus = trackBuses.get(event.trackId);
      if (bus === undefined) {
        lastIssue = {
          code: "missing_track",
          message: "Timeline event references a missing mixer track",
          relatedId: event.trackId,
        };
        continue;
      }

      let source: DrumSource | SynthVoice | undefined;
      try {
        const audioTime = audioTimeForStep(
          event.startStep,
          anchorStep,
          anchorAudioTime,
          project.bpm,
        );
        source = event.kind === "drum"
          ? sampler.schedule(event, audioTime, bus.gain)
          : synth.schedule(
            event,
            audioTime,
            event.durationSteps * secondsPerStep(project.bpm),
            bus.gain,
          );
      } catch (error) {
        if (!(error instanceof DOMException)) {
          throw error;
        }
        lastIssue = {
          code: "source_failed",
          message: "Audio source could not be scheduled",
          relatedId: event.key,
        };
        continue;
      }

      if (source === undefined) {
        lastIssue = event.kind === "drum"
          ? {
            code: "missing_sample",
            message: "Drum sample is unavailable",
            relatedId: event.soundId,
          }
          : {
            code: "unknown_preset",
            message: "Synth preset is unavailable",
            relatedId: event.instrumentId,
          };
        continue;
      }

      const retained: RetainedSource = {
        generation,
        trackId: event.trackId,
        source,
      };
      pendingSources.set(event.key, retained);
      void source.ended.then(() => {
        if (pendingSources.get(event.key)?.source === source) {
          pendingSources.delete(event.key);
        }
      });
    }
  };

  const finishArrangement = (): void => {
    clearSchedulerTimer();
    scheduledHorizonAudioTime = undefined;
    positionStep = projectArrangementEndStep;
    status = "stopped";
  };

  const enterBlockedState = (): void => {
    positionStep = currentPositionStep();
    cancelPlayback();
    status = "blocked";
  };

  const schedulerTick = (): void => {
    if (status !== "playing" || context === undefined || project === undefined) {
      return;
    }
    if (context.state !== "running") {
      enterBlockedState();
      return;
    }

    const currentAudioTime = context.currentTime;
    positionStep = currentPositionStep();
    if (positionStep >= projectArrangementEndStep) {
      finishArrangement();
      return;
    }

    const endStep = positionAtAudioTime(
      anchorStep,
      anchorAudioTime,
      currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS,
      project.bpm,
    );
    if (
      scheduledHorizonAudioTime !== undefined &&
      currentAudioTime > scheduledHorizonAudioTime
    ) {
      lateWakeups += 1;
      lastIssue = {
        code: "late_scheduler",
        message: "Scheduler woke after its look-ahead horizon",
      };
      stopPendingSources(currentAudioTime);
      generation += 1;
      scheduleRange(positionStep, endStep);
      scheduledHorizonAudioTime = currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS;
      return;
    }

    scheduleRange(positionStep, endStep);
    scheduledHorizonAudioTime = Math.max(
      scheduledHorizonAudioTime ?? 0,
      currentAudioTime + SCHEDULER_LOOKAHEAD_SECONDS,
    );
  };

  const startPlayback = (requestedStep: number): void => {
    if (context === undefined || project === undefined) {
      throw new Error("Audio engine runtime did not initialize");
    }
    cancelPlayback();
    positionStep = clampStep(requestedStep);
    anchorStep = positionStep;
    anchorAudioTime = context.currentTime + PLAYBACK_START_LEAD_SECONDS;
    generation += 1;
    status = "playing";
    try {
      scheduleRange(
        positionStep,
        positionStep + SCHEDULER_LOOKAHEAD_SECONDS / secondsPerStep(project.bpm),
      );
      scheduledHorizonAudioTime = anchorAudioTime + SCHEDULER_LOOKAHEAD_SECONDS;
      schedulerTimer = {
        handle: platform.setInterval(schedulerTick, SCHEDULER_TICK_MILLISECONDS),
      };
    } catch (error) {
      cancelPlayback();
      status = "stopped";
      throw error;
    }
  };

  const blockedResult = (): {
    readonly ok: false;
    readonly code: "blocked";
    readonly message: string;
  } => ({
    ok: false,
    code: "blocked",
    message: "Audio context is suspended; retry from a user gesture",
  });

  const closedResult = (): {
    readonly ok: false;
    readonly code: "closed";
    readonly message: string;
  } => ({
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  });

  const controlSuccess = (
    successStatus: "playing" | "paused" | "stopped",
  ): AudioControlResult => ({
    ok: true,
    status: successStatus,
    positionStep: currentPositionStep(),
  });

  const currentControlResult = (): AudioControlResult => {
    if (status === "closed") {
      return closedResult();
    }
    if (status === "blocked") {
      return blockedResult();
    }
    return controlSuccess(status);
  };

  const engine: AudioEngine = {
    prepare(): Promise<PrepareResult> {
      if (status === "closed") {
        return Promise.resolve(closedResult());
      }
      if (preparation !== undefined) {
        return preparation;
      }

      initializeRuntime();
      const runtimeContext = context;
      const runtimeSampler = sampler;
      if (runtimeContext === undefined || runtimeSampler === undefined) {
        throw new Error("Audio engine runtime did not initialize");
      }

      let pending: Promise<PrepareResult>;
      pending = (async (): Promise<PrepareResult> => {
        try {
          await runtimeContext.resume();
        } catch (error) {
          if (disposal !== undefined) {
            return closedResult();
          }
          if (!isAutoplayPolicyError(error)) {
            throw error;
          }
          enterBlockedState();
          return blockedResult();
        }
        if (disposal !== undefined) {
          return closedResult();
        }
        if (runtimeContext.state !== "running") {
          enterBlockedState();
          return blockedResult();
        }

        const samplePreparation = await runtimeSampler.prepare();
        if (disposal !== undefined) {
          return closedResult();
        }
        if (runtimeContext.state !== "running") {
          enterBlockedState();
          return blockedResult();
        }
        unavailableSoundIds = [...samplePreparation.unavailableSoundIds];
        lastIssue = unavailableSoundIds[0] === undefined
          ? undefined
          : {
            code: "missing_sample",
            message: "Drum sample is unavailable",
            relatedId: unavailableSoundIds[0],
          };
        if (status === "blocked") {
          status = "stopped";
        }
        synchronizeMixer();
        return {
          ok: true,
          status: unavailableSoundIds.length === 0 ? "ready" : "degraded",
          unavailableSoundIds: [...unavailableSoundIds],
        };
      })().finally(() => {
        if (preparation === pending) {
          preparation = undefined;
        }
      });
      preparation = pending;
      return pending;
    },

    replaceProject(nextProject: Project): void {
      if (status === "closed") {
        return;
      }
      const nextFingerprint = playbackFingerprint(nextProject);
      const compositionChanged = nextFingerprint !== projectFingerprint;
      const restartStep = status === "playing" && compositionChanged
        ? currentPositionStep()
        : undefined;
      if (restartStep !== undefined) {
        cancelPlayback();
      }
      project = nextProject;
      projectFingerprint = nextFingerprint;
      projectArrangementEndStep = arrangementEndStep(nextProject);
      positionStep = clampStep(restartStep ?? positionStep);
      synchronizeMixer();
      if (restartStep === undefined) {
        return;
      }
      if (positionStep >= projectArrangementEndStep) {
        status = "stopped";
        return;
      }
      startPlayback(positionStep);
    },

    async play(startStep: number): Promise<AudioControlResult> {
      const intentRevision = ++playIntentRevision;
      if (status === "closed") {
        return closedResult();
      }
      if (project === undefined) {
        return {
          ok: false,
          code: "no_project",
          message: "No project is loaded",
        };
      }
      if (project.arrangement.length === 0) {
        return {
          ok: false,
          code: "nothing_to_play",
          message: "Project arrangement is empty",
        };
      }

      const prepared = await engine.prepare();
      if (intentRevision !== playIntentRevision) {
        return currentControlResult();
      }
      if (!prepared.ok) {
        return prepared;
      }
      if (project.arrangement.length === 0) {
        return {
          ok: false,
          code: "nothing_to_play",
          message: "Project arrangement is empty",
        };
      }
      startPlayback(startStep);
      return controlSuccess("playing");
    },

    pause(): AudioControlResult {
      playIntentRevision += 1;
      if (status === "closed") {
        return closedResult();
      }
      if (status === "blocked") {
        return blockedResult();
      }
      if (status !== "playing") {
        return controlSuccess(status);
      }
      positionStep = currentPositionStep();
      cancelPlayback();
      status = "paused";
      return controlSuccess("paused");
    },

    seek(step: number): AudioControlResult {
      playIntentRevision += 1;
      if (status === "closed") {
        return closedResult();
      }
      if (status === "blocked") {
        return blockedResult();
      }
      const wasPlaying = status === "playing";
      positionStep = clampStep(step);
      if (wasPlaying) {
        startPlayback(positionStep);
      }
      return controlSuccess(wasPlaying ? "playing" : status);
    },

    stop(): AudioControlResult {
      playIntentRevision += 1;
      if (status === "closed") {
        return closedResult();
      }
      if (status === "stopped" && positionStep === 0 && pendingSources.size === 0) {
        return controlSuccess("stopped");
      }
      cancelPlayback();
      positionStep = 0;
      status = "stopped";
      return controlSuccess("stopped");
    },

    getSnapshot(): AudioEngineSnapshot {
      const issue = lastIssue === undefined ? undefined : { ...lastIssue };
      return {
        status,
        positionStep: currentPositionStep(),
        arrangementEndStep: projectArrangementEndStep,
        unavailableSoundIds: [...unavailableSoundIds],
        activeVoices: synth?.activeVoiceCount() ?? 0,
        pendingSources: pendingSources.size,
        lateWakeups,
        trackBusCount: trackBuses.size,
        ...(issue === undefined ? {} : { lastIssue: issue }),
      };
    },

    dispose(): Promise<void> {
      playIntentRevision += 1;
      if (disposal !== undefined) {
        return disposal;
      }
      status = "closed";
      preparation = undefined;
      cancelPlayback();
      positionStep = 0;
      sampler?.clear();
      synth?.stopAll(context?.currentTime ?? 0);
      for (const bus of trackBuses.values()) {
        bus.gain.disconnect();
        bus.panner.disconnect();
      }
      trackBuses.clear();
      master?.disconnect();
      disposal = context?.close() ?? Promise.resolve();
      return disposal;
    },
  };
  return engine;
}
