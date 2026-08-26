import type { Project, Track } from "../project/index.ts";
import { BASIC_DRUM_KIT, SYNTH_PRESETS } from "./catalog.ts";
import type { LoadArrayBuffer, Sampler } from "./sampler.ts";
import { createSampler } from "./sampler.ts";
import type { Synth } from "./synth.ts";
import { createSynth } from "./synth.ts";
import { arrangementEndStep, playbackFingerprint } from "./timeline.ts";

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

export interface AudioEnginePlatform {
  readonly createContext: () => AudioContext;
  readonly loadArrayBuffer: LoadArrayBuffer;
  readonly setInterval: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface AudioEngine {
  prepare(): Promise<PrepareResult>;
  replaceProject(project: Project): void;
  getSnapshot(): AudioEngineSnapshot;
  dispose(): Promise<void>;
}

interface TrackBus {
  readonly gain: GainNode;
  readonly panner: StereoPannerNode;
}

const MIXER_RAMP_SECONDS = 0.005;
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
  const trackBuses = new Map<string, TrackBus>();

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

  const blockedResult = (): PrepareResult => ({
    ok: false,
    code: "blocked",
    message: "Audio context is suspended; retry from a user gesture",
  });

  const closedResult = (): PrepareResult => ({
    ok: false,
    code: "closed",
    message: "Audio engine is closed; create a new engine",
  });

  return {
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
          status = "blocked";
          return blockedResult();
        }
        if (disposal !== undefined) {
          return closedResult();
        }
        if (runtimeContext.state !== "running") {
          status = "blocked";
          return blockedResult();
        }

        const samplePreparation = await runtimeSampler.prepare();
        if (disposal !== undefined) {
          return closedResult();
        }
        unavailableSoundIds = [...samplePreparation.unavailableSoundIds];
        lastIssue = unavailableSoundIds[0] === undefined
          ? undefined
          : {
            code: "missing_sample",
            message: "Drum sample is unavailable",
            relatedId: unavailableSoundIds[0],
          };
        status = "stopped";
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
      project = nextProject;
      projectFingerprint = playbackFingerprint(nextProject);
      projectArrangementEndStep = arrangementEndStep(nextProject);
      synchronizeMixer();
    },

    getSnapshot(): AudioEngineSnapshot {
      const issue = lastIssue === undefined ? undefined : { ...lastIssue };
      return {
        status,
        positionStep: 0,
        arrangementEndStep: projectArrangementEndStep,
        unavailableSoundIds: [...unavailableSoundIds],
        activeVoices: synth?.activeVoiceCount() ?? 0,
        pendingSources: 0,
        lateWakeups: 0,
        trackBusCount: trackBuses.size,
        ...(issue === undefined ? {} : { lastIssue: issue }),
      };
    },

    dispose(): Promise<void> {
      if (disposal !== undefined) {
        return disposal;
      }
      status = "closed";
      preparation = undefined;
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
}
